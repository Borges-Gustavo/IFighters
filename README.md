# IFighters

Protótipo estático de batalhas por turnos entre IFighters, com telas baseadas nas referências visuais do projeto.

## Executar localmente

Não há dependências ou etapa de build. Abra `main.html` em um navegador moderno ou sirva a pasta com qualquer servidor estático. Por exemplo, com VS Code, use a extensão Live Server.

## Controles

- Clique/toque: selecionar e confirmar.
- Enter: confirmar o item selecionado.
- Setas ou W/S: navegar por controles da tela.
- Escape/Backspace: voltar (fora da batalha).

Os dados provisórios dos IFighters e golpes ficam centralizados em `data.js`; `app.js` contém apenas a navegação, interface e motor de batalha. Preferências de animação e contraste são persistidas com `localStorage`.

## Recursos

O projeto usa sprites e cenário em `img/`. A abertura obrigatória usa o arquivo original `img/game/Game Intro.mp4`, pré-carregado e reproduzido uma vez por sessão; Enter, Espaço, Escape, clique ou toque permite avançar. A opção **REVER INTRO** fica em Configuração.
