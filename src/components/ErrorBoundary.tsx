import React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { addDevLog } from '../debugLog'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    addDevLog({
      kind: 'error',
      category: 'error-boundary',
      message: error.message || 'Unknown render error',
      stack: info.componentStack || error.stack,
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
    this.setState({ hasError: false })
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
            The application encountered an unexpected error. You can try reloading the page to recover.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Button variant="contained" onClick={this.handleReset}>
              Reload
            </Button>
            <Button variant="outlined" onClick={() => window.location.reload()}>
              Hard Reload
            </Button>
          </Box>
        </Box>
      )
    }

    return this.props.children
  }
}
