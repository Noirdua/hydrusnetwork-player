import React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { addDevLog } from '../debugLog'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
  message: string
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unknown error' }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    addDevLog({
      kind: 'error',
      category: 'error-boundary',
      message: error.message || 'Unknown render error',
      stack: info.componentStack || error.stack,
    })
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2, p: 3, textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Something went wrong
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
            The application encountered an unexpected error. Try again, or reload the page to recover.
          </Typography>
          {this.state.message && (
            <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 520, fontFamily: 'monospace', wordBreak: 'break-word' }}>
              {this.state.message}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Button variant="contained" onClick={this.handleReset}>
              Try again
            </Button>
            <Button variant="outlined" onClick={this.handleReload}>
              Reload page
            </Button>
          </Box>
        </Box>
      )
    }

    return this.props.children
  }
}
