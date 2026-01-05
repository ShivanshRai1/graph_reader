import { GraphProvider } from './context/GraphContext'
import GraphCapture from './pages/GraphCapture'
import './App.css'

function App() {
  return (
    <GraphProvider>
      <GraphCapture />
    </GraphProvider>
  )
}

export default App
