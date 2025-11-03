import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Get the root element from the index.html
const rootElement = document.getElementById('root');

// Create the root container and render the App component
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


