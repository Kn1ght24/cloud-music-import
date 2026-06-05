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
      // 兼容歌单表格 table.m-table 和个人听歌排行容器 .m-record
      if (iframeDoc && (iframeDoc.querySelector('table.m-table') || iframeDoc.querySelector('.m-record'))) {
        targetDoc = iframeDoc;
        targetWindow = iframe.contentWindow;
      }
    } catch (e) {
      console.warn("无法直接访问网易云音乐的 iframe DOM:", e);
    }
  }
  
  // 如果页面上既没有表格也没有听歌排行记录，就无需滚动直接返回
  const table = targetDoc.querySelector('table.m-table');
  const recordList = targetDoc.querySelector('.m-record');
  if (!table && !recordList) {
    return [];
  }
  
  let lastRowCount = 0;
  let noChangeTimes = 0;
  const maxScrollAttempts = 25; // 最多滚动 25 次
  
  for (let i = 0; i < maxScrollAttempts; i++) {
    let currentRows = 0;
    if (table) {
      currentRows = table.querySelectorAll('tbody tr').length;
    } else if (recordList) {
      currentRows = recordList.querySelectorAll('li').length;
    }
    
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
        // 支持歌单表格和个人听歌排行列表的 iframe 解析
        if (iframeDoc && (iframeDoc.querySelector('table.m-table') || iframeDoc.querySelector('.m-record'))) {
          targetDoc = iframeDoc;
        }
      } catch (e) {
        console.warn("无法直接访问网易云音乐的 iframe DOM (可能是跨域或未加载):", e);
      }
    }
  }
  
  // 1. 优先解析个人听歌排行 (m-record) 结构
  const recordList = targetDoc.querySelector('.m-record');
  if (recordList) {
    const items = recordList.querySelectorAll('li');
    items.forEach((item) => {
      let title = "";
      let artists = [];
      let album = ""; // 听歌排行默认没有专辑，直接置为空字符串
      
      // 提取歌曲标题，通常在 <b> 标签中，或含有 song?id= 的 a 标签
      const bTag = item.querySelector('b');
      if (bTag) {
        title = bTag.getAttribute('title') || bTag.innerText;
      } else {
        const songLink = item.querySelector('a[href*="/song?id="]');
        if (songLink) {
          title = songLink.getAttribute('title') || songLink.innerText;
        }
      }
      
      // 提取歌手，通常在 s-fc8 标签、ar 容器中，或在链接内
      const artistEl = item.querySelector('.s-fc8') || item.querySelector('.ar') || item.querySelector('span.ar');
      if (artistEl) {
        const artistLinks = artistEl.querySelectorAll('a[href*="/artist?id="]');
        if (artistLinks && artistLinks.length > 0) {
          artistLinks.forEach(link => {
            artists.push(link.getAttribute('title') || link.innerText);
          });
        } else {
          artists.push(artistEl.getAttribute('title') || artistEl.innerText);
        }
      } else {
        const artistLinks = item.querySelectorAll('a[href*="/artist?id="]');
        if (artistLinks && artistLinks.length > 0) {
          artistLinks.forEach(link => {
            artists.push(link.getAttribute('title') || link.innerText);
          });
        }
      }
      
      // 清理数据
      title = cleanText(title);
      const artistStr = artists.map(a => cleanText(a)).filter(Boolean).join(' / ');
      
      if (title) {
        songs.push({
          title: title,
          artist: artistStr || "未知歌手",
          album: album
        });
      }
    });
    
    return songs;
  }
  
  // 2. 解析网易云音乐常规歌单、排行榜和专辑的表格 (table.m-table) 结构
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
      const titleDiv = cells[1].querySelector('div.ttc span.txt');
      if (titleDiv) {
        const titleLink = titleDiv.querySelector('a[href*="/song?id="]');
        if (titleLink) {
          // 用 b 标签的 title 或 innerText 作为主歌名，这可以避免播放按钮、MV图标文本混入
          const bTag = titleLink.querySelector('b');
          title = bTag ? (bTag.getAttribute('title') || bTag.innerText) : (titleLink.getAttribute('title') || titleLink.innerText);
          
          // 检查并拼接副标题或翻译名 (如 " - (Live)")
          const subTitleSpan = titleDiv.querySelector('.s-fc3');
          if (subTitleSpan) {
            const subText = subTitleSpan.innerText.trim();
            if (subText) title += " " + subText;
          }
        }
      }
      
      if (!title) {
        title = cells[1].innerText;
      }
      
      // 2. 歌手通常在第 4 列 (index 3)
      const artistDiv = cells[3].querySelector('div.text');
      if (artistDiv) {
        // 兼容：网易云把拼接好的歌手文本存放在 title 属性中（如 "歌手1/歌手2"），可能在 div.text 上，也可能在子元素 span 上
        let artistAttr = artistDiv.getAttribute('title');
        if (!artistAttr) {
          const titledEl = artistDiv.querySelector('[title]');
          if (titledEl) {
            artistAttr = titledEl.getAttribute('title');
          }
        }
        
        if (artistAttr) {
          artists.push(artistAttr);
        } else {
          const artistLinks = artistDiv.querySelectorAll('a[href*="/artist?id="]');
          if (artistLinks && artistLinks.length > 0) {
            artistLinks.forEach(link => {
              if (link.innerText) artists.push(link.innerText);
            });
          } else {
            artists.push(artistDiv.innerText);
          }
        }
      } else {
        const artistLinks = cells[3].querySelectorAll('a[href*="/artist?id="]');
        if (artistLinks && artistLinks.length > 0) {
          artistLinks.forEach(link => {
            if (link.innerText) artists.push(link.innerText);
          });
        } else {
          const text = cells[3].innerText;
          if (text) artists.push(text);
        }
      }
      
      // 3. 专辑通常在第 5 列 (index 4)
      if (cells.length >= 5) {
        const albumDiv = cells[4].querySelector('div.text');
        if (albumDiv) {
          let albumAttr = albumDiv.getAttribute('title');
          if (!albumAttr) {
            const titledEl = albumDiv.querySelector('[title]');
            if (titledEl) {
              albumAttr = titledEl.getAttribute('title');
            }
          }
          album = albumAttr || albumDiv.innerText;
        } else {
          const albumLink = cells[4].querySelector('a[href*="/album?id="]');
          if (albumLink) {
            album = albumLink.getAttribute('title') || albumLink.innerText;
          } else {
            album = cells[4].innerText;
          }
        }
      }
    } else {
      // 方案 B: 降级方案，直接在整行中匹配关键类名或链接特征
      const titleLink = row.querySelector('a[href*="/song?id="]');
      if (titleLink) {
        const bTag = titleLink.querySelector('b');
        title = bTag ? (bTag.getAttribute('title') || bTag.innerText) : titleLink.innerText;
        
        // 查找可能存在的副标题
        const subTitleSpan = row.querySelector('.s-fc3');
        if (subTitleSpan) {
          const subText = subTitleSpan.innerText.trim();
          if (subText) title += " " + subText;
        }
      }
      
      const artistDiv = row.querySelector('td:nth-child(4) div.text');
      if (artistDiv) {
        let artistAttr = artistDiv.getAttribute('title');
        if (!artistAttr) {
          const titledEl = artistDiv.querySelector('[title]');
          if (titledEl) {
            artistAttr = titledEl.getAttribute('title');
          }
        }
        
        if (artistAttr) {
          artists.push(artistAttr);
        } else {
          const artistLinks = artistDiv.querySelectorAll('a[href*="/artist?id="]');
          artistLinks.forEach(link => {
            if (link.innerText) artists.push(link.innerText);
          });
        }
      } else {
        const artistLinks = row.querySelectorAll('a[href*="/artist?id="]');
        artistLinks.forEach(link => {
          if (link.innerText) artists.push(link.innerText);
        });
      }
      
      const albumDiv = row.querySelector('td:nth-child(5) div.text');
      if (albumDiv) {
        let albumAttr = albumDiv.getAttribute('title');
        if (!albumAttr) {
          const titledEl = albumDiv.querySelector('[title]');
          if (titledEl) {
            albumAttr = titledEl.getAttribute('title');
          }
        }
        album = albumAttr || albumDiv.innerText;
      } else {
        const albumLink = row.querySelector('a[href*="/album?id="]');
        if (albumLink) {
          album = albumLink.innerText;
        }
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

function cleanText(text) {
  if (!text) return "";
  
  // 使用自定义的实体解码器，避开 innerHTML 赋值在 CSP/Trusted Types 下的报错限制
  let decoded = decodeHtmlEntities(text);
  
  return decoded
    .replace(/[\u200b\u200e\u200f\ufeff]/g, "") // 过滤掉零宽空格、排版控制字符及可能残留的 BOM 字符
    .replace(/[\xa0\u3000]/g, " ")  // 将不换行空格 (\xa0) 和全角空格 (\u3000) 替换为标准的普通空格
    .replace(/\r?\n|\r/g, " ")     // 替换换行符为空格
    .replace(/\s+/g, " ")          // 合并多个空白字符
    .trim();
}

/**
 * 自定义 HTML 实体解码器，安全且不依赖于 DOM 节点的 innerHTML 属性赋值，
 * 可完美规避 CSP（内容安全策略）和 Trusted Types 限制。
 */
function decodeHtmlEntities(str) {
  if (!str) return "";
  
  const entities = {
    'amp': '&',
    'lt': '<',
    'gt': '>',
    'quot': '"',
    'apos': "'",
    'nbsp': ' ',
    'middot': '·',
    'ldquo': '“',
    'rdquo': '”',
    'lsquo': '‘',
    'rsquo': '’',
    'bull': '•',
    'deg': '°',
    'sup2': '²',
    'sup3': '³',
    'copy': '©',
    'reg': '®',
    'trade': '™'
  };

  let result = str;

  // 1. 十六进制数字实体, 例如 &#x5468; -> 周
  result = result.replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch (e) {
      return match;
    }
  });

  // 2. 十进制数字实体, 例如 &#21608; -> 周
  result = result.replace(/&#([0-9]+);/g, (match, dec) => {
    try {
      return String.fromCharCode(parseInt(dec, 10));
    } catch (e) {
      return match;
    }
  });

  // 3. 命名 HTML 实体, 例如 &middot; -> · 或 &amp; -> &
  result = result.replace(/&([a-zA-Z0-9]+);/g, (match, name) => {
    const lowerName = name.toLowerCase();
    if (entities.hasOwnProperty(lowerName)) {
      return entities[lowerName];
    }
    return match; // 未知实体保持原样
  });

  // 4. 作为最后的安全兜底，使用不依赖当前文档上下文的 DOMParser 进行解析
  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(result, 'text/html');
      if (doc && doc.body) {
        const docText = doc.body.textContent || doc.body.innerText;
        if (docText) {
          result = docText;
        }
      }
    }
  } catch (e) {
    // 忽略异常
  }

  return result;
}
