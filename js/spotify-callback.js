(() => {
  const params = new URLSearchParams(location.search);
  if (window.opener) {
    window.opener.postMessage({ type: 'vinyl:spotify', code: params.get('code'), state: params.get('state'), error: params.get('error') }, location.origin);
    history.replaceState(null, '', location.pathname);
    window.close();
  } else document.querySelector('p').textContent = '请返回播放器重新连接 Spotify。';
})();
