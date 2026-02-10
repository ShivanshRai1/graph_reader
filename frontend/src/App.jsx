import { GraphProvider } from './context/GraphContext'
import GraphCapture from './pages/GraphCapture'
import SavedGraphView from './pages/SavedGraphView'
import './App.css'

function App() {
  const searchParams = new URLSearchParams(window.location.search)
  const viewMode = searchParams.get('view')
  const curveId = searchParams.get('curveId')

  return (
    <GraphProvider>
      {viewMode === 'curve' ? <SavedGraphView curveId={curveId} /> : <GraphCapture />}
    </GraphProvider>
  )
}

export default App
