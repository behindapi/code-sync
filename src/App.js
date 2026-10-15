import './App.css';
import React from 'react';
import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import Home from './pages/Home';
import EditorPage from './pages/EditorPage';
function App() {
  return <>
    <div>
      <Toaster position='top-right' toastOptions={
        {
          success: {
            theme: {
              primary: '#ced4da'
            }
          }
        }}></Toaster>
    </div>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/editor/:roomId" element={<EditorPage />} />
      <Route path="*" element={<Home />} />
    </Routes>
  </>
}

export default App;
