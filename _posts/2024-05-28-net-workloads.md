---
layout: post
title: .NET Workloads 101
published: true
---

# Introducción

En el post de [.NET MAUI 101](https://mookiefumi.com/2024-05-27-maui-101) expuse algo de info respecto a los workloads que me gustaría ampliar pero conviene recordar lo siguiente.

En .NET, un "workload" es **un conjunto de herramientas y bibliotecas que se instalan y configuran juntos para permitir el desarrollo de aplicaciones específicas**. Los workloads están diseñados para simplificar la instalación y configuración de entornos de desarrollo para diferentes tipos de proyectos.

Según la documentación oficial, los beneficios de los workloads son:

* **Facilidad de instalación**: Instalan todo lo necesario de una sola vez.
* **Consistencia**: Garantizan que todos los desarrolladores de un equipo tienen las mismas herramientas y versiones.
* **Gestión de dependencias**: Simplifican la gestión de dependencias.

> Los workloads se instalan de forma global, por lo que una vez instalado estará disponible en cualquier proyecto sin importaren en que carpeta/ directorio estés trabajando.

# Comandos básicos

## ¿Qué workloads tengo instalados?

**```dotnet workload list```**
```
Installed Workload Id      Manifest Version       Installation Source
---------------------------------------------------------------------
maui-ios                   8.0.21/8.0.100         SDK 8.0.200        
maui-android               8.0.21/8.0.100         SDK 8.0.200        
maccatalyst                17.2.8053/8.0.100      SDK 8.0.200        
maui                       8.0.21/8.0.100         SDK 8.0.200 
```

* **Manifest version**: Muestra la versión del manifiesto del workload instalado.

* **Installation source**: Indica la fuente de instalación del workload.

### Manifest version

* Un manifiesto es un archivo de configuración (json) que describe las dependencias, componentes y configuraciones necesarias para el workload. [En este enlace tienes más info al respecto de .NET SDK Worload Manifest](https://github.com/dotnet/designs/blob/main/accepted/2020/workloads/workload-manifest.md).
* Que aparezcan dos versiones en Manifest version puede indicar múltiples componentes del mismo workload o coexistencia de versiones.
* Si hacemos el ejercicio de localizar el manifiesto de por ejemplo "maui-ios" vemos las dependencias que tiene:
    * ios
        * Microsoft.iOS.Sdk.net8
		* Microsoft.iOS.Sdk.net7
		* Microsoft.iOS.Windows.Sdk.Aliased.net8
		* Microsoft.iOS.Windows.Sdk.Aliased.net7
		* Microsoft.iOS.Ref
		* Microsoft.iOS.Runtime.ios-arm64
		* Microsoft.iOS.Runtime.iossimulator-x64
		* Microsoft.iOS.Runtime.iossimulator-arm64
		* Microsoft.iOS.Templates.net
        * extends: 
            * microsoft-net-runtime-ios
		    * microsoft-net-runtime-ios-net7
    * maui-blazor
        * Microsoft.AspNetCore.Components.WebView.Maui
        * extends: 
            * maui-core
                * Microsoft.Maui.Sdk.net8
                * Microsoft.Maui.Sdk.net7
                * Microsoft.Maui.Graphics
                * Microsoft.Maui.Resizetizer
                * Microsoft.Maui.Resizetizer.Sdk
                * Microsoft.Maui.Templates.net8"
                * Microsoft.Maui.Templates.net7
                * Microsoft.Maui.Core
                * Microsoft.Maui.Controls
                * Microsoft.Maui.Controls.Build.Tasks
                * Microsoft.Maui.Controls.Core
                * Microsoft.Maui.Controls.Xaml
                * Microsoft.Maui.Controls.Compatibility
                * Microsoft.Maui.Essentials    

### ¿Dónde se instalan los workloads?

> Ojo! Mi entorno de trabajo/ desarrollo es macOS por lo que las rutas son específicas para este OS.

Los componentes de .NET se instalan en el directorio de herramientas del SDK de .NET, que normalmente se encuentra en **```/usr/local/share/dotnet/```**.

Y dentro de este directorio tenemos otras carpetas:

* **```/usr/local/share/dotnet/sdk```**. Contiene las diferentes versiones que tengamos instalados del SDK de .NET.
* **```/usr/local/share/dotnet/packs```**. Contiene los diferentes packs necesarios para los workloads, tales como frameworks o runtime packs.

## ¿Cómo instalo un workload?

Es posible que tengas que ejecutar este comando con permisos elevados.

**```dotnet workload install maui```**

## ¿Qué otras acciones puedo hacer con dotnet workload?

Más allá de instalar o listar los workloads que tenemos instalados podemos desde líena de comandos actualizar, buscar, desinstalar, reparar, limpiar o incluso hacer un restore de un workload de un proyecto o solución específico.

**```dotnet workload -h```**
```
Description:
  Install or work with workloads that extend the .NET experience.

Usage:
  dotnet workload [command] [options]

Commands:
  install <WORKLOAD_ID>         Install one or more workloads.
  update                        Update all installed workloads.
  list                          List workloads available.
  search <SEARCH_STRING>        Search for available workloads.
  uninstall <WORKLOAD_ID>       Uninstall one or more workloads.
  repair                        Repair workload installations.
  restore <PROJECT | SOLUTION>  Restore workloads required for a project.
  clean                         Removes workload components that may have been left behind from previous updates and 
                                uninstallations.
```

## ¿Cómo puedo obtener información ampliada respecto a los workloads que tengo instalados?

**```dotnet workload --info```**
```
 Workload version: 8.0.200-manifests.6751eab7
 [maui-ios]
   Installation Source: SDK 8.0.200
   Manifest Version:    8.0.21/8.0.100
   Manifest Path:       /usr/local/share/dotnet/sdk-manifests/8.0.100/microsoft.net.sdk.maui/8.0.21/WorkloadManifest.json
   Install Type:        FileBased

 [maui-android]
   Installation Source: SDK 8.0.200
   Manifest Version:    8.0.21/8.0.100
   Manifest Path:       /usr/local/share/dotnet/sdk-manifests/8.0.100/microsoft.net.sdk.maui/8.0.21/WorkloadManifest.json
   Install Type:        FileBased

 [maccatalyst]
   Installation Source: SDK 8.0.200
   Manifest Version:    17.2.8053/8.0.100
   Manifest Path:       /usr/local/share/dotnet/sdk-manifests/8.0.100/microsoft.net.sdk.maccatalyst/17.2.8053/WorkloadManifest.json
   Install Type:        FileBased

 [maui]
   Installation Source: SDK 8.0.200
   Manifest Version:    8.0.21/8.0.100
   Manifest Path:       /usr/local/share/dotnet/sdk-manifests/8.0.100/microsoft.net.sdk.maui/8.0.21/WorkloadManifest.json
   Install Type:        FileBased
```