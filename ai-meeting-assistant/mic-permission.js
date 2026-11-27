// mic-permission.js — xin quyền micro cho origin của extension.
// Offscreen document (nơi ghi hình) không hiện được hộp hỏi quyền, nên quyền
// phải được cấp trước ở một trang hiển thị bình thường như trang này.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const backTabId = Number(params.get('tab')) || null;

  const grantBtn = document.getElementById('grantBtn');
  const backBtn  = document.getElementById('backBtn');
  const status   = document.getElementById('status');

  function show(cls, html) {
    status.className = 'status ' + cls;
    status.innerHTML = html;
  }

  function done() {
    grantBtn.disabled = true;
    grantBtn.textContent = 'Đã cấp quyền';
    show('ok', 'Đã cấp quyền micro. Quay lại tab cuộc họp, mở popup → <b>Record</b> → <b>Bắt đầu ghi</b>.');
    if (backTabId) backBtn.style.display = '';
  }

  backBtn.addEventListener('click', () => {
    chrome.tabs.update(backTabId, { active: true }, tab => {
      void chrome.runtime.lastError;
      if (tab?.windowId != null) chrome.windows.update(tab.windowId, { focused: true }, () => void chrome.runtime.lastError);
      chrome.tabs.getCurrent(cur => { if (cur?.id != null) chrome.tabs.remove(cur.id); });
    });
  });

  grantBtn.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      done();
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError');
      show('err', denied
        ? 'Quyền micro đang bị chặn. Bấm biểu tượng ổ khoá / micro ở thanh địa chỉ của trang này → cho phép <b>Micro</b>, rồi bấm lại.'
        : 'Không mở được micro (' + (e && (e.name || e.message)) + '). Kiểm tra micro đã cắm và không bị app khác giữ.');
    }
  });

  // Đã có quyền từ trước → báo luôn
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'microphone' }).then(p => {
      if (p.state === 'granted') done();
    }).catch(() => {});
  }
})();
