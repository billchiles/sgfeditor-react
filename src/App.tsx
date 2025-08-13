//import React from "react";
// import GoBoard from "./GoBoard";

// function App() {
//   return (
//     <div className="App" /*style={{ padding: 16 }}*/>

//       <h1>SGFEditor</h1>
//       <GoBoard />
//     </div>
//   );
// }

//export default App;


import GoBoard from "./components/GoBoard";

export default function App() { 
  return <GoBoard boardSize={19} cellSize={32} showCoords />;
}