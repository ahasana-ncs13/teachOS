import { Component } from 'react'
import ErrorPage from '../pages/ErrorPage'

export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('TeachOS page render failed:', error, errorInfo)
  }

  reset = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) return <ErrorPage code={500} onRetry={this.reset} />
    return this.props.children
  }
}
