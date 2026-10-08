import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// 화면의 시작점입니다. API 연결이나 상태 판단은 여기서 하지 않습니다.
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
