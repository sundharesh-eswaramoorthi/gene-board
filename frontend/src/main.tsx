import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// From react-router/dom so navigate(..., { flushSync: true }) can use react-dom's flushSync.
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from '@/api/queryClient'
import { AuthProvider } from '@/auth/AuthProvider'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { router } from './app/router'
import { ThemeProvider } from './app/ThemeProvider'
import { Toaster } from './app/Toaster'
import './index.css'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={400} skipDelayDuration={200}>
            <ConfirmProvider>
              <RouterProvider router={router} />
            </ConfirmProvider>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
      <Toaster />
    </ThemeProvider>
  </StrictMode>,
)
