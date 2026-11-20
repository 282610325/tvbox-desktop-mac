/** 当前渲染进程是不是那个独立的播放器窗口（主窗口是 false） */
export const isPlayerWindow =
  new URLSearchParams(window.location.search).get('player') === '1'
