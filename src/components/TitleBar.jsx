import React from 'react'
import './TitleBar.css'

export default function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <div className="titlebar-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#e8a030" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="titlebar-title">SPT Mod Manager</span>
      </div>
      <div className="titlebar-controls">
        <button onClick={() => window.electronAPI.minimize()} className="ctrl-btn ctrl-min">─</button>
        <button onClick={() => window.electronAPI.maximize()} className="ctrl-btn ctrl-max">▢</button>
        <button onClick={() => window.electronAPI.close()} className="ctrl-btn ctrl-close">✕</button>
      </div>
    </div>
  )
}
