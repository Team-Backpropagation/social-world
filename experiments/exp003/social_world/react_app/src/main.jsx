import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App.jsx'
import ShowcaseV2 from './showcase/ShowcaseV2.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {window.location.protocol === 'file:' ? <ShowcaseV2 /> : <BrowserRouter><App /></BrowserRouter>}
  </StrictMode>,
)
