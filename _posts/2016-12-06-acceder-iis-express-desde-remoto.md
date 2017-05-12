---
layout: post
title: Acceder a IIS Express desde un equipo remoto
published: true
---

Más de una vez hemos querido hacer que nuestro IIS Express sea accesible desde fuera de nuestra máquina de desarrollo para probar algo de forma puntual. Y como es costumbre no nos lo han puesto nada fácil por lo que deberemos seguir los siguientes pasos:

### Enlazar nuestra aplicación a una dirección IP pública
Para enlazar nuestra aplicación a una dirección IP pública deberemos añadir un nuevo binding (enlace) a nuestra aplicación. Para ello deberemos modificar el archivo applicationhost.config que desde la versión 2015 de Microsoft Visual Studio se encuentra en la misma ruta del proyecto, exactamente dentro de _**/.vs/config**_.

En este archivo encontraremos el binging existente de nuesta aplicación y únicamente deberemos añadir un nuevo. La dirección IP deberá ser la del equipo dónde está alojada la app con el IIS Express y el puerto deberá ser diferente al que tenga la instanacia para localhost de la app.

```
<binding protocol="http" bindingInformation="*:51343:192.168.0.12" />
```

> Sólo añadiendo esta línea, si levantamos nuestra aplicación veremos como en el icono del IIS Express ha levantado dos instancias en diferentes puertos, una para la previamente existente y otra para la nueva que acabamos de crear.

### Permitir conexiones entrantes
Para permitir conexiones entrantes deberemos ejecutar las siguientes comandos desde un cmd/ terminal en **modo administrador**.

* Agregar una reserva de dirección. Ojo! Dependiendo del idioma del sistema operativo en user pondremos **todos** o **all** _(nunca llegaré a entender que lleguen a traducir este tipo de cosas)_.

```
netsh http add urlacl url=http://192.168.0.12:51343/ user=todos
```

* Añadir una expepción en nuestro firewall

```
netsh advfirewall firewall add rule name="IISExpress Exception" dir=in protocol=tcp localport=51343 profile=private remoteip=localsubnet action=allow
```

Este post es una mera traducción del [artículo](http://johan.driessen.se/posts/Accessing-an-IIS-Express-site-from-a-remote-computer) de Johan Driessen.