import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

function StartupError() {
  return (
    <main className="startup-error" role="alert">
      <section>
        <h1>YourTalkerを起動できませんでした</h1>
        <p>アプリ連携機能の読み込みに失敗しました。アプリを終了してから、最新版を再インストールしてください。</p>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.yourTalker ? <App /> : <StartupError />}
  </StrictMode>
)
