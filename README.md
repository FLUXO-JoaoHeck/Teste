# Simulador de Painel de Alívio de Tanque (VAPV)

Simulador visual interativo do comportamento de um tanque de armazenamento
com válvula de inertização (N₂), VAPV (alívio de pressão e vácuo) e válvula
de emergência, reagindo a bombeamento (enchimento/esvaziamento) e a efeitos
térmicos (dilatação/contração).

> Modelo educacional simplificado, inspirado conceitualmente em sistemas de
> "tank blanketing" / PVRV (ex.: Emerson). Não reproduz nenhuma imagem,
> marca ou arte de fabricante — os ícones em `/icons` são desenhos originais
> e substituíveis.

## Arquivos

```
index.html   → estrutura da página
style.css    → todo o visual (paleta, layout, painel HMI)
script.js    → física simplificada + lógica das válvulas + animação
icons/       → ícones de válvulas e instrumentos (SVG, substituíveis)
```

## Como trocar os ícones das válvulas/instrumentos

Cada válvula é um bloco HTML independente em `index.html`, dentro de
`.schematic-wrap`, por exemplo:

```html
<div class="equip-node" id="nodeVapv" style="--x:50%; --y:15%;">
  <img class="equip-icon" src="icons/valve-pvrv.svg" alt="...">
  ...
</div>
```

Para trocar a imagem, basta:
1. Substituir o conteúdo do arquivo `icons/valve-pvrv.svg` (ou apontar o
   `src` para outro arquivo/imagem sua), **ou**
2. Ajustar `--x` / `--y` (posição em % da área do esquema) e o tamanho em
   `.equip-icon` no `style.css` para reposicionar.

Isso vale para:
- `nodeInert` → válvula de inertização
- `nodeVapv` → VAPV (pressão/vácuo)
- `nodeEmerg` → válvula de emergência
- `nodeLevel` → instrumento de nível (**reservado**, ainda não conectado à lógica)
- `tempRuler` / `tempRulerPoints` → régua de temperatura multiponto ao longo
  do tanque (**reservada** — hoje todos os pontos refletem uma única
  temperatura simulada; pronta para receber um modelo de inventário
  estratificado no futuro)

## Como rodar localmente

Não precisa de build nem de dependências. Duas opções:

**A) Abrir direto**
Clique duas vezes em `index.html`.

**B) Servidor local (recomendado, evita bloqueios de CORS em alguns navegadores)**
```bash
cd tanque-simulador
python3 -m http.server 8080
```
Depois acesse `http://localhost:8080`.

## Como hospedar no GitHub Pages

1. Crie um repositório novo no GitHub (público, para o Pages gratuito).
2. Envie estes arquivos para a raiz do repositório:
   ```bash
   git init
   git add .
   git commit -m "Simulador VAPV"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git push -u origin main
   ```
3. No GitHub: **Settings → Pages → Source** → selecione a branch `main` e a
   pasta `/ (root)` → **Save**.
4. Em alguns minutos o site estará em:
   `https://SEU_USUARIO.github.io/SEU_REPOSITORIO/`

## Próximos passos sugeridos

- Conectar `nodeLevel` a um valor real de nível (já existe `state.level` no
  `script.js`, só falta ligar visualmente ao instrumento).
- Expandir `TEMP_POINTS` em `script.js` para um modelo estratificado real
  (cada ponto com sua própria temperatura/altura), quando o modelo de
  inventário completo estiver pronto.
- Se quiser, posso também montar uma tela separada de "inventário" (volume,
  massa, densidade) reaproveitando os mesmos tokens visuais.
