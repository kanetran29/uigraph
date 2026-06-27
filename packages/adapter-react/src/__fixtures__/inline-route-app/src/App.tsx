import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'
import { Navbar } from './components/Navbar'

function App() {
  return (
    <Router>
      <Navbar />
      <div className="App">
        <Routes>
          <Route
            path="/"
            element={
              <section>
                <h2>Welcome</h2>
              </section>
            }
          />
          <Route path="/posts/:postId" element={<section>post</section>} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
