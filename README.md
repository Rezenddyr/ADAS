# Cena3D ADAS

Editor 3D low poly para montar cenas e explicar funções ADAS (ACC, FCW/AEB, DDD, Park Assist, câmera 360…) passo a passo, com foto, vídeo e GIF.

## Abrir

Abra `Cena3D.html` no Chrome ou Edge (precisa de internet para carregar o three.js) e digite a senha.

## Gerar de novo depois de mudar o código

O código fica em `cena3d-fonte/`. Para gerar o `Cena3D.html`:

```bash
cd cena3d-fonte
node build.js              # protegido com a senha de cena3d-fonte/senha.txt
node build.js --sem-senha  # sem trava, só para testes
```

A senha fica em `cena3d-fonte/senha.txt` (uma linha). Esse arquivo não vai para o git: guarde a senha num lugar seguro.

## Conteúdo

- `cena3d-fonte/`: código do app (`core`, `procs`, `roads`, `characters`, `hud`, `features`, `ui`), tela de senha (`lock.html`), personagens convertidos e ícones.
- `kenney_city-kit-roads_2.2/`, `LowPolyVehiclesPack_v1.0/`, `LowPoly_CityStreet_v1.0/`: pacotes de modelos (só os `.glb` que o build usa). Veja a licença de cada pacote antes de tornar o repositório público.
