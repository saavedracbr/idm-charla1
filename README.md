# Charla 1 · Investigar mercados con Gemini

Primera charla para el Círculo de Inteligencia de Datos en Marketing (IDM) de la Universidad de Lima: de la pregunta de negocio al insight en 60 minutos, con Gemini @aloe y el caso ficticio Tikay.

**Deck en línea:** https://idm-charla1.saavedracbr.com

## Carpetas

| Carpeta | Qué tiene |
|---|---|
| `deck/` | La presentación (HTML estático). Es lo único que se publica en Pages. |
| `kit_alumnos/` | Lo que reciben los alumnos: entrevistas en PDF, ficha práctica, guía de planes y prompts. |
| `fuentes/` | Textos y HTML de origen del kit. |
| `construccion/` | Entrevistas en HTML, de las que salen los PDF. |
| `plantillas/` | Estilos de los documentos del kit. |
| `plan_b/` | Respaldos: el deck en PDF y la versión anterior del deck. |

## Presentar en local

```
cd deck
python -m http.server 8000
```

Abre `http://localhost:8000`. También funciona abriendo `deck/index.html` con doble clic, sin internet. Atajos: **←/→** navegar, **P** vista de presentador, **F** pantalla completa, **C** cronómetro, **B** pantalla negra.

## Publicación

Cada empujón a `main` despliega `deck/` con `.github/workflows/deploy.yml`.
