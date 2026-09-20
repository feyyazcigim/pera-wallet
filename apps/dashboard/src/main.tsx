import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import './app/app.css'
import Landing from './App.tsx'
import { Toaster } from './toast.tsx'

// the dashboard is a separate chunk — the landing page doesn't pay for it
const Roadmap = lazy(() => import('./Roadmap.tsx').then((m) => ({ default: m.Roadmap })))
const Shell = lazy(() => import('./app/Shell.tsx').then((m) => ({ default: m.Shell })))
const Onboard = lazy(() => import('./app/Onboard.tsx').then((m) => ({ default: m.Onboard })))
const Home = lazy(() => import('./app/Home.tsx').then((m) => ({ default: m.Home })))
const Rules = lazy(() => import('./app/Rules.tsx').then((m) => ({ default: m.Rules })))
const Agents = lazy(() => import('./app/Agents.tsx').then((m) => ({ default: m.Agents })))
const Analytics = lazy(() => import('./app/Analytics.tsx').then((m) => ({ default: m.Analytics })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster />
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/app/onboard" element={<Onboard />} />
          <Route path="/app" element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="rules" element={<Rules />} />
            <Route path="agents" element={<Agents />} />
            <Route path="analytics" element={<Analytics />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
