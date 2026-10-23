import './App.css';
import Header from './components/Header';
import Filters from './components/Filters';
import ResourceOverview from './components/ResourceOverview';
import ProjectSites from './components/ProjectSites';
import ProjectDetails from './components/ProjectDetails';
import AddProject from './components/AddProject';

function App() {
  return (
    <div className="app">
      <Header />

      <main className="app-body">
        <Filters />

        <div className="column column-middle">
          <ResourceOverview />
          <ProjectSites />
        </div>

        <div className="column column-right">
          <ProjectDetails />
          <AddProject />
        </div>
      </main>
    </div>
  );
}

export default App;