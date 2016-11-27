---
layout: post
title: Entendiendo Semantic Versioning
published: true
---

Tengo que renocer que nunca he prestado demasiada importancia al tema de las versiones de los componentes que he utilizado tanto en los proyectos llevados a cabo nivel empresarial como en mis proyectos personales. Pero una vez metido en el desarrollo de Node.Js y revisando el archivo package.json que es el que contiene entre otras cosas las referencias a componentes externos (dependencias), me he dado cuenta de que no puedo estar más tiempo sin conocer y entender el sistema de versionado. Y en este caso quiero revisar [Semantic Versioning](http://semver.org) que vino para quedarse ya que resuelve el famoso "infierno de las dependencias" proponiendo un conjunto simple de reglas y requisitos de como se incrementan los números de versión.

### Especificación de Semantic Versioning
* El formato de versión es **X.Y.Z** (Mayor.Minor.Patch)
* **Mayor** se incrementa cuando realizamos breaking changes y rompemos compatibilidad con la API existente.
* **Minor** se incrementa cuando añadimos funcionalidad sin romper compatibilidad.
* **Patch** se incrementa cuando hemos corregido errores o bugs.

Por lo tanto aplicando el formato comentado a la versión 3.9.1 de lodash:

* Mayor: 3
* Minor: 9
* Patch: 1

### Rangos
Cuando gestionamos dependencias podemos usar rangos de versión para evitar actualizar nuestro componente cada vez que una dependencia se actualice.

* "**3.9.1**": La versión debe coincidir exactamente con la versión especificada.
* "**=3.9.1**": Exactamente igual que el anterior.
* "**>3.9.1**": La versión debe ser mayor que la indicada. Ojo! Mayor tanto en X.Y.Z, es decir, 3.9.2, 3.9.3, 3.10.0 y 4.0.0.
* "**>=3.9.1**": Debe ser mayor o igual que la versión especificada.
* "**<3.9.1**": Debe ser menor que la versión especificada.
* "**<=3.9.1**": Debe ser menor o igual que la versión especificada.
* "**3.9.1 - 4.0.1**": Debe ser mayor o igual que version1 y menor o igual que version2. En este caso 3.9.1, 3.9.2, 3.9.3, 3.10.0, 4.0.0 y 4.0.1.
* "**3.9.x**": Debe comenzar con 3.9 pero cualquier dígito se puede utilizar en lugar de la x. En este caso 3.9.0, 3.9.1, 3.9.2, 3.9.3.
* "*": Coincide con cualquier versión
* "**~3.9.1**": Incluir todo lo que sea mayor que una versión particular en el mismo rango Minor. En este caso sería 3.9.1, 3.9.2 y 3.9.3.
* "**^3.9.1**": Incluir todo lo que sea mayor que una versión particular en el mismo rango Mayor. En este caso 3.9.1, 3.9.2, 3.9.3, 3.10.0.

Buscando material para este artículo he encontrado la página llamada [npm semver calculator](https://semver.npmjs.com) que sirve para practicar con las versiones y su formato de forma dinámica.