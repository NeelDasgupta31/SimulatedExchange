import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { HostPanel } from './HostPanel.jsx'

const isHost = window.location.pathname === '/host';

ReactDOM.createRoot(document.getElementById('root')).render(
  isHost ? <HostPanel /> : <App />
)
