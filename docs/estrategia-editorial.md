# Estrategia editorial

Punto de partida: la lista de ideas de Mookie (19 temas, 3 ya publicados más GitVersion) y las series que ya existen en `src/data/series.yml`. Es una propuesta para ajustar, no un compromiso.

## Idea central: publicar por grupos, no por temas sueltos

Google valora que un sitio cubra un tema en profundidad y que sus páginas se enlacen entre sí. Un post suelto sobre Aspire compite solo contra toda la web. Cuatro posts sobre Aspire y OpenTelemetry que se enlazan entre sí, y una página `/series/…` que los reúne, dan más señales de que el blog es una referencia en el tema, y a quien lee le da un camino.

Cada grupo de abajo sería una serie nueva en `src/data/series.yml`. Cada post nuevo lleva `series:` en el front matter y su meta description escrita a mano (ver `descripciones.md` en la auditoría).

## Grupos propuestos

| Grupo | Ideas de la lista | Ya existe |
| --- | --- | --- |
| Gobernanza .NET (seguir) | 18 Supply chain (SBOM, Dependabot, firmado) | 1, 2, 3 y 7 (GitVersion) publicados |
| APIs y arquitectura | 4 Minimal APIs y OpenAPI nativo, 8 Vertical slice, 17 Monolito modular vs. microservicios | |
| Cloud-native con Aspire | 5 Aspire, 6 OpenTelemetry, 9 Testcontainers | Laboratorio de MCP con Aspire y Rancher |
| IA en .NET | 10 Microsoft.Extensions.AI, 12 Agent Framework, 13 RAG, 11 Spec Kit vs. OpenSpec | Series de OpenSpec y MCP |
| Plataforma .NET | 14 Novedades de .NET 10 y C# 14, 15 HybridCache, 16 Native AOT, 19 Single-file apps | |

## Orden y ritmo

- **Un post por semana**, siempre el mismo día, antes que cuatro seguidos y un mes de silencio. El blog pasó de agosto a septiembre con varios posts en pocos días; para Google y para quien se suscribe al RSS es más útil un ritmo estable.
- **Un grupo cada vez.** Empezar por APIs y arquitectura (4, 8) porque es la base de los siguientes, seguir con Aspire (5, 6, 9) y después IA (10, 12, 13, 11). Plataforma .NET encaja como posts cortos entre grupos.
- **Novedades de .NET 10 y C# 14** es la idea con más caducidad: si .NET 11 sale en noviembre, conviene publicarla ya o convertirla en «de .NET 10 a .NET 11».
- **Supply chain** (18) cierra la serie de gobernanza, así que va donde se enlace con CPM, Directory.Build.props y las Actions.

## Cada post

- Tamaño: píldora (unas 800 palabras) por defecto y artículo largo solo cuando el tema lo pida.
- Título con el problema o la palabra que alguien buscaría («OpenTelemetry en .NET con el dashboard de Aspire»), no solo con el nombre de la herramienta.
- Enlaces al post anterior y al siguiente de su grupo, y a uno ya publicado de otro grupo cuando venga a cuento.
- Borrador de LinkedIn en Typefully, sin programar hasta que Mookie lo apruebe.

## Qué se mide

Con Search Console verificado (tarea pendiente de Mookie), cada mes: páginas indexadas frente a publicadas, consultas con impresiones y qué serie tiene más clics. Si una serie no mueve nada en tres meses, se revisa su título o su enfoque antes de escribir más posts de ella.
