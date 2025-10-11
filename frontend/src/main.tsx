import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { CheatCodeProvider } from './contexts/CheatCodeContext.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { RequireAuth } from './components/RequireAuth.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RequireAuth>
          <CheatCodeProvider>
            <App />
          </CheatCodeProvider>
        </RequireAuth>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)