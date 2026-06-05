// popup.js

document.addEventListener("DOMContentLoaded", () => {
  // DOM 元素获取
  const pulseDot = document.getElementById("pulseDot");
  const statusText = document.getElementById("statusText");
  const songCount = document.getElementById("songCount");
  const btnAnalyze = document.getElementById("btnAnalyze");
  const btnOpenTab = document.getElementById("btnOpenTab");
  
  const songsListCard = document.getElementById("songsListCard");
  const songSearchInput = document.getElementById("songSearchInput");
  const btnSearchClear = document.getElementById("btnSearchClear");
  const chkSelectAll = document.getElementById("chkSelectAll");
  const btnInvertSelect = document.getElementById("btnInvertSelect");
  const songsContainer = document.getElementById("songsContainer");
  
  const settingsCard = document.getElementById("settingsCard");
  const filenameInput = document.getElementById("filenameInput");
  const extensionSuffix = document.getElementById("extensionSuffix");
  const csvOptionGroup = document.getElementById("csvOptionGroup");
  const includeHeader = document.getElementById("includeHeader");
  const btnExport = document.getElementById("btnExport");
  const btnCopy = document.getElementById("btnCopy");
  const tipsText = document.getElementById("tipsText");
  
  // 临时存储解析出来的歌曲数据，包含选定状态 checked
  let parsedSongs = [];
  let playlistTitle = "";

  // 辅助函数：跨窗口寻找可用的网易云音乐页面标签页
  function findNetEaseTab(callback) {
    // 1. 优先在当前窗口查询 active 标签页
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const activeTab = tabs[0];
        if (activeTab.url && activeTab.url.includes("music.163.com")) {
          callback(activeTab);
          return;
        }
      }
      
      // 2. 如果当前活跃标签不是网易云（如插件在独立新 Tab 模式下打开），则在所有窗口中寻找包含 music.163.com 的标签页
      chrome.tabs.query({ url: "*://*.music.163.com/*" }, (allTabs) => {
        if (allTabs && allTabs.length > 0) {
          // 优先取其中在各自窗口中处于 active 状态的，或者直接取第一个
          const activeOnes = allTabs.filter(t => t.active);
          callback(activeOnes.length > 0 ? activeOnes[0] : allTabs[0]);
        } else {
          callback(null);
        }
      });
    });
  }

  // 1. 初始化检查当前标签页 URL 状态
  findNetEaseTab((targetTab) => {
    if (targetTab) {
      setPageStatus("ready", "已连接网易云音乐页面");
      btnAnalyze.removeAttribute("disabled");
    } else {
      setPageStatus("error", "请打开网易云音乐");
      btnAnalyze.setAttribute("disabled", "true");
      showTip("请在浏览器中打开网易云音乐网页版歌单、排行榜或专辑详情页后使用此插件。", true);
    }
  });

  // 独立标签页打开功能绑定
  if (btnOpenTab) {
    btnOpenTab.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    });
    
    // 如果插件当前本身正作为独立的 Tab 页面运行，则隐藏此按钮
    const url = window.location.href;
    if (url.startsWith("chrome-extension://") && !url.includes("popup.html?popup=true")) {
      btnOpenTab.style.display = "none";
    }
  }

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
    setPageStatus("loading", "正在提取并自动加载滚动...");

    // 重置搜索框
    songSearchInput.value = "";
    btnSearchClear.style.display = "none";

    // 寻找可用的网易云页面并发送提取歌曲命令
    findNetEaseTab((targetTab) => {
      if (!targetTab) {
        handleAnalyzeError("未检测到运行中的网易云音乐页面，请先打开网易云。");
        return;
      }
      
      chrome.tabs.sendMessage(targetTab.id, { action: "EXTRACT_SONGS" }, (response) => {
        // 检查通信是否出错 (例如 content script 未加载完毕)
        if (chrome.runtime.lastError) {
          handleAnalyzeError("未检测到歌单数据。请刷新网页后，重新打开本插件重试。");
          console.error("Communication error:", chrome.runtime.lastError);
          return;
        }
        
        if (response && response.success) {
          // 将歌曲转化为带有 checked 标志的对象数组
          parsedSongs = (response.songs || []).map(song => ({
            ...song,
            checked: true
          }));
          
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

  // 4. 搜索栏事件监听
  songSearchInput.addEventListener("input", (e) => {
    const query = e.target.value;
    if (query) {
      btnSearchClear.style.display = "flex";
    } else {
      btnSearchClear.style.display = "none";
    }
    renderSongsList(query);
    updateSelectAllState();
  });

  btnSearchClear.addEventListener("click", () => {
    songSearchInput.value = "";
    btnSearchClear.style.display = "none";
    renderSongsList("");
    updateSelectAllState();
    songSearchInput.focus();
  });

  // 5. 全选复选框的事件监听 (仅针对当前过滤可见的歌曲)
  chkSelectAll.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    const query = songSearchInput.value;
    const filtered = getFilteredSongs(query);
    
    filtered.forEach(song => {
      song.checked = isChecked;
      const idx = parsedSongs.indexOf(song);
      const chk = document.getElementById(`song-chk-${idx}`);
      if (chk) {
        chk.checked = isChecked;
        const item = songsContainer.querySelector(`.song-item[data-index="${idx}"]`);
        if (item) {
          if (isChecked) {
            item.classList.add("song-item-checked");
          } else {
            item.classList.remove("song-item-checked");
          }
        }
      }
    });
    updateCountDisplay();
  });

  // 6. 反选按钮的点击监听 (仅针对当前过滤可见的歌曲)
  btnInvertSelect.addEventListener("click", () => {
    const query = songSearchInput.value;
    const filtered = getFilteredSongs(query);
    
    filtered.forEach(song => {
      song.checked = !song.checked;
      const idx = parsedSongs.indexOf(song);
      const chk = document.getElementById(`song-chk-${idx}`);
      if (chk) {
        chk.checked = song.checked;
        const item = songsContainer.querySelector(`.song-item[data-index="${idx}"]`);
        if (item) {
          if (song.checked) {
            item.classList.add("song-item-checked");
          } else {
            item.classList.remove("song-item-checked");
          }
        }
      }
    });
    updateSelectAllState();
    updateCountDisplay();
  });

  // 7. 确认导出按钮点击事件
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
      // 在下载 CSV 文件时拼接前置 BOM \ufeff 标志，以便 Excel 识别不产生中文乱码
      fileContent = "\ufeff" + convertToCSV(selectedSongs, includeHeader.checked);
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

  // 8. 复制到剪贴板按钮点击事件
  btnCopy.addEventListener("click", () => {
    const selectedSongs = getSelectedSongs();
    if (selectedSongs.length === 0) {
      showTip("请至少选择一首歌曲进行复制。", true);
      return;
    }

    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    let content = "";
    
    if (format === "csv") {
      // 剪贴板复制不能带 \ufeff 标志，否则粘贴在应用里会出现不可见的乱码首字符
      content = convertToCSV(selectedSongs, includeHeader.checked);
    } else if (format === "json") {
      content = JSON.stringify(selectedSongs, null, 2);
    } else if (format === "txt") {
      content = convertToTXT(selectedSongs);
    }

    // 写入剪贴板
    navigator.clipboard.writeText(content)
      .then(() => {
        triggerCopySuccessEffect();
      })
      .catch(err => {
        console.error("复制失败:", err);
        showTip("复制到剪贴板失败，请重试或直接下载文件。", true);
      });
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
      songSearchInput.removeAttribute("disabled");
      settingsCard.classList.remove("disabled");
      btnExport.removeAttribute("disabled");
      btnCopy.removeAttribute("disabled");
      
      // 默认设置为全选
      chkSelectAll.checked = true;
      
      // 渲染歌曲列表
      renderSongsList("");
      
      // 更新选择计数
      updateCountDisplay();
      
      showTip("解析成功！已自动加载完整列表。您可以勾选或搜索特定歌曲导出。");
    } else {
      setPageStatus("error", "未检测到歌曲");
      songsListCard.classList.add("disabled");
      songSearchInput.setAttribute("disabled", "true");
      settingsCard.classList.add("disabled");
      btnExport.setAttribute("disabled", "true");
      btnCopy.setAttribute("disabled", "true");
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
    songSearchInput.setAttribute("disabled", "true");
    settingsCard.classList.add("disabled");
    btnExport.setAttribute("disabled", "true");
    btnCopy.setAttribute("disabled", "true");
    songsContainer.innerHTML = "";
    songCount.textContent = "0";
    songCount.classList.remove("active");
    showTip(`解析失败：${errorMsg}`, true);
  }

  /**
   * 过滤歌单列表
   */
  function getFilteredSongs(query) {
    if (!query) return parsedSongs;
    const cleanQuery = query.toLowerCase().trim();
    return parsedSongs.filter(song => 
      song.title.toLowerCase().includes(cleanQuery) || 
      song.artist.toLowerCase().includes(cleanQuery) || 
      song.album.toLowerCase().includes(cleanQuery)
    );
  }

  /**
   * 渲染歌曲多选列表
   */
  function renderSongsList(query = "") {
    songsContainer.innerHTML = "";
    const filtered = getFilteredSongs(query);
    
    filtered.forEach((song) => {
      // 获取该歌曲在原始 parsedSongs 中的索引位置
      const originalIndex = parsedSongs.indexOf(song);
      
      const item = document.createElement("div");
      item.className = `song-item ${song.checked ? 'song-item-checked' : ''}`;
      item.setAttribute("data-index", originalIndex);
      
      item.innerHTML = `
        <label class="checkbox-container" style="pointer-events: none; margin: 0;">
          <input type="checkbox" id="song-chk-${originalIndex}" ${song.checked ? 'checked' : ''}>
          <span class="checkbox-checkmark"></span>
        </label>
        <div class="song-details">
          <span class="song-title-text">${escapeHtml(song.title)}</span>
          <span class="song-meta-text">${escapeHtml(song.artist)} - ${escapeHtml(song.album)}</span>
        </div>
      `;
      
      // 点击整行项目切换勾选状态
      item.addEventListener("click", () => {
        song.checked = !song.checked;
        const chk = document.getElementById(`song-chk-${originalIndex}`);
        if (chk) {
          chk.checked = song.checked;
          if (song.checked) {
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

    // 如果搜索结果为空
    if (filtered.length === 0 && parsedSongs.length > 0) {
      const noResult = document.createElement("div");
      noResult.className = "tips-info";
      noResult.style.padding = "20px 0";
      noResult.textContent = "未找到符合过滤条件的歌曲";
      songsContainer.appendChild(noResult);
    }
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
      btnCopy.removeAttribute("disabled");
      showTip(`已勾选 ${selectedCount} / ${parsedSongs.length} 首歌曲，配置完成后可导出或复制。`);
    } else {
      songCount.classList.remove("active");
      btnExport.setAttribute("disabled", "true");
      btnCopy.setAttribute("disabled", "true");
      showTip("请至少勾选一首歌曲进行操作！", true);
    }
  }

  /**
   * 判断并更新全选复选框的状态 (针对当前过滤的歌曲)
   */
  function updateSelectAllState() {
    const query = songSearchInput.value;
    const filtered = getFilteredSongs(query);
    if (filtered.length === 0) {
      chkSelectAll.checked = false;
      return;
    }
    
    const allChecked = filtered.every(song => song.checked);
    chkSelectAll.checked = allChecked;
  }

  /**
   * 获取所有被勾选的歌曲数据
   */
  function getSelectedSongs() {
    return parsedSongs.filter(song => song.checked);
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
   * 将歌曲数组转换为 CSV 格式 (带双引号转义，无 BOM 前缀)
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
    
    return csvRows.join("\n");
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
      <span>已下载！</span>
    `;
    
    setTimeout(() => {
      btnExport.style.background = "";
      btnExport.innerHTML = originalContent;
    }, 2000);
  }

  /**
   * 触发复制按钮成功状态效果
   */
  function triggerCopySuccessEffect() {
    const originalContent = btnCopy.innerHTML;
    
    btnCopy.style.background = "var(--success-gradient)";
    btnCopy.style.borderColor = "transparent";
    btnCopy.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" class="btn-icon">
        <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      <span>已复制！</span>
    `;
    
    setTimeout(() => {
      btnCopy.style.background = "";
      btnCopy.style.borderColor = "";
      btnCopy.innerHTML = originalContent;
    }, 2000);
  }
});
