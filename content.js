// 监听来自扩展 Popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT_SONGS") {
    // 异步执行自动滚动和提取
    scrollAndExtractSongs()
      .then((songs) => {
        sendResponse({ 
          success: true, 
          songs: songs, 
          url: window.location.href,
          title: document.title
        });
      })
      .catch((error) => {
        sendResponse({ 
          success: false, 
          error: error.message 
        });
      });
  }
  return true; // 保持通道开启以进行异步响应
});

/**
 * 自动滚动网页并提取网易云音乐网页中的歌单表格，处理懒加载问题
 */
async function scrollAndExtractSongs() {
  let targetDoc = document;
  let targetWindow = window;
  
  // 网易云网页版核心内容通常嵌套在 id 为 g_iframe 的 iframe 中。
  const iframe = document.getElementById('g_iframe') || 
                 document.querySelector('iframe[name="contentFrame"]') || 
                 document.querySelector('iframe');
  
  if (iframe) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      if (iframeDoc && iframeDoc.querySelector('table.m-table')) {
        targetDoc = iframeDoc;
        targetWindow = iframe.contentWindow;
      }
    } catch (e) {
      console.warn("无法直接访问网易云音乐的 iframe DOM:", e);
    }
  }
  
  // 如果页面上没有表格，就无需滚动直接返回
  const table = targetDoc.querySelector('table.m-table');
  if (!table) {
    return [];
  }
  
  let lastRowCount = 0;
  let noChangeTimes = 0;
  const maxScrollAttempts = 25; // 最多滚动 25 次
  
  for (let i = 0; i < maxScrollAttempts; i++) {
    const currentRows = table.querySelectorAll('tbody tr').length;
    
    // 判断是否有新的行被渲染
    if (currentRows === lastRowCount) {
      noChangeTimes++;
      if (noChangeTimes >= 2) {
        // 连续两次没有新数据，说明全部加载完毕
        break;
      }
    } else {
      noChangeTimes = 0;
      lastRowCount = currentRows;
    }
    
    // 滚动 iframe 窗口到底部
    if (targetWindow && targetWindow.scrollTo) {
      targetWindow.scrollTo(0, targetDoc.body.scrollHeight || targetDoc.documentElement.scrollHeight);
    }
    // 同时滚动主窗口以防万一
    window.scrollTo(0, document.body.scrollHeight || document.documentElement.scrollHeight);
    
    // 等待 350ms 触发网易云音乐的懒加载和网络加载渲染
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  
  // 滚动结束，提取歌曲
  return parsePlaylist(targetDoc);
}

/**
 * 解析网易云音乐网页中的歌单表格
 */
function parsePlaylist(targetDoc = document) {
  const songs = [];
  
  // 如果传入 document 且存在 iframe，则获取 iframe 的 document
  if (targetDoc === document) {
    const iframe = document.getElementById('g_iframe') || 
                   document.querySelector('iframe[name="contentFrame"]') || 
                   document.querySelector('iframe');
    
    if (iframe) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc && iframeDoc.querySelector('table.m-table')) {
          targetDoc = iframeDoc;
        }
      } catch (e) {
        console.warn("无法直接访问网易云音乐的 iframe DOM (可能是跨域或未加载):", e);
      }
    }
  }
  
  // 网易云音乐歌单、排行榜和专辑的歌曲列表表格通常是 table.m-table
  const table = targetDoc.querySelector('table.m-table');
  if (!table) {
    return songs;
  }
  
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach((row) => {
    let title = "";
    let artists = [];
    let album = "";
    
    const cells = row.cells;
    
    // 方案 A: 严格基于表格列索引解析（最精准，避免各列链接混淆）
    if (cells && cells.length >= 4) {
      // 1. 歌曲标题通常在第 2 列 (index 1)
      const titleLink = cells[1].querySelector('a[href*="/song?id="]');
      if (titleLink) {
        // 网易云有些歌曲名在 a 内部的 b 标签中，带有 title 属性
        const bTag = titleLink.querySelector('b');
        if (bTag) {
          title = bTag.getAttribute('title') || bTag.innerText;
        } else {
          title = titleLink.getAttribute('title') || titleLink.innerText;
        }
      } else {
        // 降级使用文本
        title = cells[1].innerText;
      }
      
      // 2. 歌手通常在第 4 列 (index 3)
      const artistLinks = cells[3].querySelectorAll('a[href*="/artist?id="]');
      if (artistLinks && artistLinks.length > 0) {
        artistLinks.forEach(link => {
          if (link.innerText) artists.push(link.innerText);
        });
      } else {
        // 如果没有链接但有文本（例如没有歌手主页）
        const text = cells[3].innerText;
        if (text) artists.push(text);
      }
      
      // 3. 专辑通常在第 5 列 (index 4)
      if (cells.length >= 5) {
        const albumLink = cells[4].querySelector('a[href*="/album?id="]');
        if (albumLink) {
          album = albumLink.getAttribute('title') || albumLink.innerText;
        } else {
          album = cells[4].innerText;
        }
      }
    } else {
      // 方案 B: 降级方案，直接在整行中匹配关键类名或链接特征
      // 匹配歌曲链接
      const titleLink = row.querySelector('a[href*="/song?id="]');
      if (titleLink) {
        const bTag = titleLink.querySelector('b');
        title = bTag ? (bTag.getAttribute('title') || bTag.innerText) : titleLink.innerText;
      }
      
      // 匹配歌手链接
      const artistLinks = row.querySelectorAll('a[href*="/artist?id="]');
      artistLinks.forEach(link => {
        if (link.innerText) artists.push(link.innerText);
      });
      
      // 匹配专辑链接
      const albumLink = row.querySelector('a[href*="/album?id="]');
      if (albumLink) {
        album = albumLink.innerText;
      }
    }
    
    // 清理和格式化提取的数据
    title = cleanText(title);
    const artistStr = artists.map(a => cleanText(a)).filter(Boolean).join(' / ');
    album = cleanText(album);
    
    // 过滤掉网易云的图标字符或多余换行
    if (title && title !== "歌名" && title !== "歌曲标题") {
      songs.push({
        title: title,
        artist: artistStr || "未知歌手",
        album: album || "未知专辑"
      });
    }
  });
  
  return songs;
}

/**
 * 辅助函数：清理多余的空白字符及特殊字符
 */
function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/\r?\n|\r/g, " ") // 替换换行符为空格
    .replace(/\s+/g, " ")      // 合并多个空格
    .trim();
}
