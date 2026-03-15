SoundShift - Conversor de áudio

Conversor de áudio client-side. Todos os arquivos são processados diretamente no navegador, sem servidores e sem uploads.

[![🚀 Ver Demo ao Vivo](https://img.shields.io/badge/Clique_aqui_para_ir_ao_site-22c55e?style=for-the-badge)](https://adam-gon.github.io/SoundShift/)

---
*Funcionalidades:*  

Conversao de audio diretamente no navegador, sem backend;  
Suporte a multiplos arquivos simultaneamente;  
Fila de conversao com progresso individual por arquivo;  
Controle de bitrate para formatos com perda;  
Download individual ou de todos os arquivos de uma vez;  
Limite de 300 MB por arquivo;  
Drag and drop ou selecao pelo explorador de arquivos.  

---
Formatos Entrada:  
MP3, WAV, OGG, FLAC, AAC, M4A, OPUS, WebM, WMA, AIFF  
Saida:  
MP3, WAV, AIFF, OGG, FLAC, AAC, OPUS
MP3, WAV e AIFF funcionam em qualquer navegador moderno via encoder puro JavaScript.
OGG, FLAC, AAC e OPUS dependem do suporte do MediaRecorder no navegador do usuario.
---
Estrutura
```
soundshift/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── encoder.js
│   └── app.js
└── README.md
```
