// popup.js

document.addEventListener("DOMContentLoaded", () => {
  // DOM 元素获取
  const pulseDot = document.getElementById("pulseDot");
  const statusText = document.getElementById("statusText");
  const songCount = document.getElementById("songCount");
  const btnAnalyze = document.getElementById("btnAnalyze");
  
  const songsListCard = document.getElementById("songsListCard");
  const chkSelectAll = document.getElementById("chkSelectAll");
  const btnInvertSelect = document.getElementById("btnInvertSelect");
  const songsContainer = document.getElementById("songsContainer");
  
  const settingsCard = document.getElementById("settingsCard");
  const filenameInput = document.getElementById("filenameInput");
  const extensionSuffix = document.getElementById("extensionSuffix");
  const csvOptionGroup = document.getElementById("csvOptionGroup");
  const includeHeader = document.getElementById("includeHeader");
  const btnExport = document.getElementById("btnExport");
  const tipsText = document.getElementById("tipsText");
  
  // 临时存储解析出来的歌曲数据
  let parsedSongs = [];
  let playlistTitle = "";

  // 1. 初始化检查当前标签页 URL 状态
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) {
      const activeTab = tabs[0];
      const url = activeTab.url || "";
      
      // 判断是否在网易云音乐域名下
      if (url.includes("music.163.com")) {
        setPageStatus("ready", "已连接网易云音乐页面");
        btnAnalyze.removeAttribute("disabled");
      } else {
        setPageStatus("error", "请进入网易云音乐");
        btnAnalyze.setAttribute("disabled", "true");
        showTip("请在网易云音乐网页版歌单、排行榜或专辑页面使用此插件。", true);
      }
    }
  });

  // 2. 格式选择单选框的事件监听
  const formatRadioButtons = document.querySelectorAll('input[name="exportFormat"]');
  formatRadioButtons.forEach(radio => {
    radio.addEventListener("change", (e) => {
      const format = e.target.value;
      extensionSuffix.textContent = `.${format}`;
      
      // 只有 CSV 格式显示 "包含表头" 选项
      if (format === "csv") {
        csvOptionGroup.style.display = "block";
      } else {
        csvOptionGroup.style.display = "none";
      }
    });
  });

  // 3. 一键解析按钮点击事件
  btnAnalyze.addEventListener("click", () => {
    btnAnalyze.classList.add("loading");
    btnAnalyze.setAttribute("disabled", "true");
    setPageStatus("loading", "正在提取歌曲数据...");

    // 向活动标签页发送消息
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        handleAnalyzeError("无法获取当前活动标签页");
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: "EXTRACT_SONGS" }, (response) => {
        // 检查通信是否出错 (例如 content script 未加载完毕)
        if (chrome.runtime.lastError) {
          handleAnalyzeError("未检测到歌单数据。请刷新网页后，重新打开本插件重试。");
          console.error("Communication error:", chrome.runtime.lastError);
          return;
        }
        
        if (response && response.success) {
          parsedSongs = response.songs || [];
          
          // 从网页标题提取一个默认文件名，净化多余后缀
          if (response.title) {
            playlistTitle = response.title
              .replace(/\s*-\s*歌单\s*-\s*网易云音乐/i, "")
              .replace(/\s*-\s*排行榜\s*-\s*网易云音乐/i, "")
              .replace(/\s*-\s*专辑\s*-\s*网易云音乐/i, "")
              .replace(/\s*-\s*网易云音乐/i, "")
              .replace(/[\\\/:*?"<>|]/g, "_") // 过滤掉 Windows 文件名非法字符
              .trim();
            
            if (playlistTitle) {
              filenameInput.value = playlistTitle;
            }
          }
          
          handleAnalyzeSuccess(parsedSongs);
        } else {
          handleAnalyzeError(response ? response.error : "解析数据失败");
        }
      });
    });
  });

  // 4. 全选复选框的事件监听
  chkSelectAll.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    const items = songsContainer.querySelectorAll(".song-item");
    items.forEach(item => {
      const idx = item.getAttribute("data-index");
      const chk = document.getElementById(`song-chk-${idx}`);
      if (chk) {
        chk.checked = isChecked;
        if (isChecked) {
          item.classList.add("song-item-checked");
        } else {
          item.classList.remove("song-item-checked");
        }
      }
    });
    updateCountDisplay();
  });

  // 5. 反选按钮的点击监听
  btnInvertSelect.addEventListener("click", () => {
    const items = songsContainer.querySelectorAll(".song-item");
    items.forEach(item => {
      const idx = item.getAttribute("data-index");
      const chk = document.getElementById(`song-chk-${idx}`);
      if (chk) {
        chk.checked = !chk.checked;
        if (chk.checked) {
          item.classList.add("song-item-checked");
        } else {
          item.classList.remove("song-item-checked");
        }
      }
    });
    updateSelectAllState();
    updateCountDisplay();
  });

  // 6. 确认导出按钮点击事件
  btnExport.addEventListener("click", () => {
    const selectedSongs = getSelectedSongs();
    if (selectedSongs.length === 0) {
      showTip("请至少选择一首歌曲进行导出。", true);
      return;
    }

    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    let filename = filenameInput.value.trim() || "网易云歌单导出";
    filename = filename.replace(/[\\\/:*?"<>|]/g, "_"); // 过滤非法字符
    
    let fileContent = "";
    let mimeType = "text/plain";
    
    if (format === "csv") {
      fileContent = convertToCSV(selectedSongs, includeHeader.checked);
      mimeType = "text/csv;charset=utf-8;";
    } else if (format === "json") {
      fileContent = JSON.stringify(selectedSongs, null, 2);
      mimeType = "application/json;charset=utf-8;";
    } else if (format === "txt") {
      fileContent = convertToTXT(selectedSongs);
      mimeType = "text/plain;charset=utf-8;";
    }

    // 触发下载
    downloadFile(fileContent, `${filename}.${format}`, mimeType);
    
    // 成功状态反馈
    triggerExportSuccessEffect();
  });

  // --- 辅助逻辑与交互函数 ---

  function setPageStatus(status, text) {
    pulseDot.className = "pulse-dot";
    statusText.className = "status-text";
    statusText.textContent = text;
    
    if (status === "ready") {
      pulseDot.classList.add("active");
      statusText.classList.add("active");
    } else if (status === "error") {
      pulseDot.classList.add("error");
      statusText.classList.add("error");
    } else if (status === "loading") {
      // 保持灰色转圈
    }
  }

  function showTip(text, isError = false) {
    tipsText.textContent = text;
    if (isError) {
      tipsText.classList.add("error");
    } else {
      tipsText.classList.remove("error");
    }
  }

  /**
   * 解析成功回调
   */
  function handleAnalyzeSuccess(songs) {
    btnAnalyze.classList.remove("loading");
    btnAnalyze.removeAttribute("disabled");
    
    if (songs.length > 0) {
      setPageStatus("ready", `成功解析出 ${songs.length} 首歌曲`);
      
      // 启用各个卡片面板
      songsListCard.classList.remove("disabled");
      settingsCard.classList.remove("disabled");
      btnExport.removeAttribute("disabled");
      
      // 默认设置为全选
      chkSelectAll.checked = true;
      
      // 渲染歌曲列表
      renderSongsList(songs);
      
      // 更新选择计数
      updateCountDisplay();
      
      showTip("解析成功！您可以勾选特定歌曲，设置格式后导出。");
    } else {
      setPageStatus("error", "未检测到歌曲");
      songsListCard.classList.add("disabled");
      settingsCard.classList.add("disabled");
      btnExport.setAttribute("disabled", "true");
      songsContainer.innerHTML = "";
      songCount.textContent = "0";
      songCount.classList.remove("active");
      showTip("未在页面中提取到歌曲，请确保网易云歌单歌曲列表已经显示出来。", true);
    }
  }

  function handleAnalyzeError(errorMsg) {
    btnAnalyze.classList.remove("loading");
    btnAnalyze.removeAttribute("disabled");
    setPageStatus("error", "解析出错");
    songsListCard.classList.add("disabled");
    settingsCard.classList.add("disabled");
    btnExport.setAttribute("disabled", "true");
    songsContainer.innerHTML = "";
    songCount.textContent = "0";
    songCount.classList.remove("active");
    showTip(`解析失败：${errorMsg}`, true);
  }

  /**
   * 渲染歌曲多选列表
   */
  function renderSongsList(songs) {
    songsContainer.innerHTML = "";
    
    songs.forEach((song, index) => {
      const item = document.createElement("div");
      item.className = "song-item song-item-checked";
      item.setAttribute("data-index", index);
      
      item.innerHTML = `
        <label class="checkbox-container" style="pointer-events: none; margin: 0;">
          <input type="checkbox" id="song-chk-${index}" checked>
          <span class="checkbox-checkmark"></span>
        </label>
        <div class="song-details">
          <span class="song-title-text">${escapeHtml(song.title)}</span>
          <span class="song-meta-text">${escapeHtml(song.artist)} - ${escapeHtml(song.album)}</span>
        </div>
      `;
      
      // 点击整行项目切换勾选状态
      item.addEventListener("click", () => {
        const chk = document.getElementById(`song-chk-${index}`);
        if (chk) {
          chk.checked = !chk.checked;
          if (chk.checked) {
            item.classList.add("song-item-checked");
          } else {
            item.classList.remove("song-item-checked");
          }
          
          updateSelectAllState();
          updateCountDisplay();
        }
      });
      
      songsContainer.appendChild(item);
    });
  }

  /**
   * 刷新并计算当前已选中的歌曲数量，联动修改显示数字
   */
  function updateCountDisplay() {
    const selectedCount = getSelectedSongs().length;
    songCount.textContent = selectedCount;
    
    if (selectedCount > 0) {
      songCount.classList.add("active");
      btnExport.removeAttribute("disabled");
      showTip(`已勾选 ${selectedCount} / ${parsedSongs.length} 首歌曲，配置完成后可点击确认导出。`);
    } else {
      songCount.classList.remove("active");
      btnExport.setAttribute("disabled", "true");
      showTip("请至少勾选一首歌曲进行导出！", true);
    }
  }

  /**
   * 判断并更新全选复选框的状态
   */
  function updateSelectAllState() {
    const checkboxes = songsContainer.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length === 0) return;
    
    let allChecked = true;
    checkboxes.forEach(chk => {
      if (!chk.checked) {
        allChecked = false;
      }
    });
    
    chkSelectAll.checked = allChecked;
  }

  /**
   * 获取所有被勾选的歌曲数据
   */
  function getSelectedSongs() {
    const selected = [];
    parsedSongs.forEach((song, idx) => {
      const chk = document.getElementById(`song-chk-${idx}`);
      if (chk && chk.checked) {
        selected.push(song);
      }
    });
    return selected;
  }

  /**
   * HTML 字符转义，防止恶意或特殊字符破坏 DOM
   */
  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * 将歌曲数组转换为 CSV 格式 (带双引号转义，防乱码)
   */
  function convertToCSV(songs, withHeader) {
    const csvRows = [];
    
    if (withHeader) {
      csvRows.push('"歌曲名","歌手","专辑"');
    }
    
    songs.forEach(song => {
      const title = song.title.replace(/"/g, '""');
      const artist = song.artist.replace(/"/g, '""');
      const album = song.album.replace(/"/g, '""');
      
      csvRows.push(`"${title}","${artist}","${album}"`);
    });
    
    return "\ufeff" + csvRows.join("\n");
  }

  /**
   * 将歌曲数组转换为 TXT 格式
   */
  function convertToTXT(songs) {
    const lines = [];
    lines.push(`=== 网易云音乐歌单导出列表 ===`);
    if (playlistTitle) {
      lines.push(`歌单名称: ${playlistTitle}`);
    }
    lines.push(`导出时间: ${new Date().toLocaleString()}`);
    lines.push(`歌曲总数: ${songs.length} 首`);
    lines.push(`==================================================\n`);
    
    songs.forEach((song, index) => {
      const padIndex = String(index + 1).padStart(String(songs.length).length, '0');
      lines.push(`${padIndex}. ${song.title} - ${song.artist} (专辑: ${song.album})`);
    });
    
    return lines.join("\n");
  }

  /**
   * 触发浏览器下载
   */
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * 触发导出按钮成功状态效果
   */
  function triggerExportSuccessEffect() {
    const originalContent = btnExport.innerHTML;
    
    btnExport.style.background = "var(--success-gradient)";
    btnExport.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" class="btn-icon">
        <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      <span>导出成功并下载！</span>
    `;
    
    setTimeout(() => {
      btnExport.style.background = "";
      btnExport.innerHTML = originalContent;
    }, 2000);
  }
});
