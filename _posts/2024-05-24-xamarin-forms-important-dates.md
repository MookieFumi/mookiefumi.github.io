---
layout: post
title: Fechas importantes para Xamarin Forms
published: true
---

## Fechas importantes en Xamarin Forms

Actualmente como tech lead en desarrollo de aplicaciones móviles colaboro con diferentes equipos de desarrollo y tecnologías, desde el equipo de aplicaciones móviles cross-platform (Xamarin Forms) hasta el equipo de aplicaciones móviles en nativo (Kotlin) y llevo un tiempo pendiente y trabajando respecto a la preparación de la migración de los proyectos en Xamarin Forms (exactamente son 3 con una base bastante sólida de código compartido) a Microsoft MAUI pero me gustaría poder exponer por aquí un poco el timeline que hace unos meses ha ofrecido Microsoft respecto a este tema.

### Introducción

Hace aproximadamente 4 meses David Ortinau (.NET Product Manager en Microsoft) [anunciaba a través de las redes sociales](https://www.linkedin.com/posts/davidortinau_xamarin-to-net-upgrade-survey-activity-7153471606655193088-m0SG) unas fechas importantes respecto a Xamarin Forms y que afectan tanto a los desarrolladores en Windows como en MacOS aunque especialmente estos últimos tenemos algún incoveniente más que a continuación intentaré detallar y explicar con algo más de detalle.

### Timeline.

#### 1 de mayo de 2024
Fin del soporte oficial de Xamarin

El **fin del soporte oficial de Xamarin el 1 de mayo de 2024** marca un hito importante para los desarrolladores que utilizan esta tecnología para crear aplicaciones móviles multiplataforma. A partir de esta fecha, Microsoft **dejará de proporcionar actualizaciones de seguridad y correcciones de errores para Xamarin**. Esto significa que los desarrolladores que continúen utilizando Xamarin después de esta fecha podrían estar expuestos a posibles vulnerabilidades de seguridad y problemas de compatibilidad.

---

#### 14 de mayo de 2024
Fin del soporte oficial de .NET 7

El **fin del soporte oficial de .NET 7 el 14 de mayo de 2024** es otro cambio importante que afecta a los desarrolladores de aplicaciones móviles. A partir de esta fecha, Microsoft **dejará de proporcionar actualizaciones y soporte para la versión 7 de .NET**, lo que significa que los desarrolladores deberán migrar sus aplicaciones a versiones más recientes de .NET para mantenerlas actualizadas y compatibles con las últimas tecnologías y estándares.

---

#### 31 de agosto de 2024
Retirada del soporte de Visual Studio para Mac

La **retirada del soporte de Visual Studio para Mac el 31 de agosto de 2024** es una noticia significativa para los desarrolladores que utilizan esta herramienta para desarrollar y depurar aplicaciones móviles en entornos macOS. A partir de esta fecha, **Visual Studio para Mac dejará de recibir actualizaciones y soporte**, lo que significa que los desarrolladores deberán buscar alternativas para continuar con su flujo de trabajo de desarrollo de aplicaciones móviles en macOS.

---

#### Abril de 2025
Última oportunidad de aceptación de aplicaciones Xamarin en la App Store de Apple

Se espera que **abril de 2025 sea el último momento en que la App Store de Apple acepte aplicaciones Xamarin construidas con Xcode 15**. Esto significa que los desarrolladores que deseen publicar nuevas aplicaciones o actualizaciones en la App Store después de esta fecha deberán utilizar versiones más recientes de Xcode o considerar alternativas a Xamarin.

---

#### Agosto de 2025
Última oportunidad de aceptación de aplicaciones Xamarin en la Google Play Store.

Se espera que **agosto de 2025 sea el último momento en que la Google Play Store acepte aplicaciones Xamarin que apunten a la API 34**. Esto significa que los desarrolladores que deseen publicar nuevas aplicaciones o actualizaciones en la Google Play Store después de esta fecha deberán actualizar sus aplicaciones para cumplir con los requisitos de la API más reciente o considerar alternativas a Xamarin.

---

### ¿Y ahora qué? ¿Qué opciones tenemos?

Ante los próximos cambios en el soporte y las fechas límite mencionadas, es importante considerar las siguientes opciones para seguir desarrollando y publicando nuestras aplicaciones en los markets tanto de Google como de Apple.

* **Migración a .NET MAUI**: .NET MAUI (Multi-platform App UI) es la evolución de Xamarin.Forms y está diseñado para permitir el desarrollo de aplicaciones multiplataforma con una única base de código en .NET. 
  > Es la opción que hemos elegido para mantener el stack de desarrollo y poder seguir evolucionando nuestras aplicaciones.

  > Hemos tenido que analizar a vista de pájaro todas y cada una de las dependencias tanto del proyecto compartido como de los proyectos nativos y **cabe destacar la sustitución de Prism como framework "hormonado" para manejar nuestros ViewModels** debido a su cambio en la licencia y **hemos optado por la opción de CommunityToolkit** que parece que es la opción común y por la que vamos a apostar.

* **Uso de Visual Studio Code con C# Dev Kit**: Microsoft está impulsando el uso de Visual Studio Code con el nuevo C# Dev Kit y extensiones relacionadas como una alternativa para el desarrollo de aplicaciones en .NET y C#. Puedes utilizar Visual Studio Code en cualquier sistema operativo, incluido macOS, y aprovechar las capacidades de desarrollo multiplataforma.

* **Exploración de alternativas de desarrollo**: Además de las opciones mencionadas, también puedes explorar otras alternativas de desarrollo para crear aplicaciones móviles multiplataforma. Evalúa diferentes frameworks y herramientas disponibles en el mercado y elige la que mejor se adapte a tus necesidades y requisitos de desarrollo.
  > Ejemplos como Flutter o Kotlin Multiplatorm empiezan a tener mucho auge.

### Próximos pasos

Quiero empezar a hacer una prueba de concepto, super ridícula, que sea una aplicación en Microsoft MAUI e intentar hacer la misma en algo en lo que no me encuentro tan cómodo como es Kotlin Multiplatform y poder después de esto poder comparar ambos frameworks de desarrollo con despliegue a Android y iOS.

> Intentaré dejar por aquí documentado todo el proceso de ambos PoCs.