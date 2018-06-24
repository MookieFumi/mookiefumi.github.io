---
layout: post
title: Extraer base de datos SQLite de un emulador iOS
published: true
---

## Introducción

Es la continuación del post [Extraer base de datos SQLite de un terminal Android](http://mookiefumi.com/2018-06-24-extraer-bbdd-sqlite-de-terminal-android) pero orientado absolutamente a como extraer una BBDD de SQLite de un **emulador iOS**. De hecho, debebería haber sido el primero de los post ya que utilizo **iOS como plataforma por defecto para ejecutar los proyectos en Xamarin Forms** ya que tengo que reconocer que aunque los emuladores de Android son excelentes y más después de las últimas actualizaciones del SDK, el emulador de iOS es algo más ágil e incluso el tener abiertos varios emuladores no parece que vaya a despegar de la mesa el MBP.

## Ubicación de la base de datos

Este ejemplo es una aplicación **Xamarin Forms** y como las rutas varían en función de la plataforma dónde se ejecute, esta configuración es específica y la tenemos en nuestro proyecto iOS.

```csharp
public class SQLiteClient : ISQLiteClient
{
    public SQLiteAsyncConnection GetConnection()
    {
        var sqliteFilename = "MyDatabase.db";
        var documentsPath = Environment.GetFolderPath(Environment.SpecialFolder.Personal);
        var path = Path.Combine(documentsPath, "..", "Library");
        ///Users/mookiefumi/Library/Developer/CoreSimulator/Devices/A4450735-90FA-49F5-98AB-B35DB54A6894/data/Containers/Data/Application/54E45B15-3E6A-4C38-BBB0-FA5CC2EC2F7C/Documents/../Library

        return new SQLiteAsyncConnection(Path.Combine(path, sqliteFilename));
    }
}
```

A diferencia de la ruta del emulador de Android, esta ruta es local y es de nuestro MBP. Por lo que parece algo más fácil acceder alchivo de BBDD SQLite. Examinemos la ruta que nos ha devuelto:

**Users/mookiefumi/Library/Developer/CoreSimulator/Devices/A4450735-90FA-49F5-98AB-B35DB54A6894/data/Containers/Data/Application/54E45B15-3E6A-4C38-BBB0-FA5CC2EC2F7C/Documents/../Library**

* Nos encontramos un primer GUID que es nuestro dispositivo, si queremos saber el GUID con que emulador/ simulador corresponde tenemos que ir a XCode -> Windows -> Devices and Simulators. En este caso es el emulador/ simulador de un IPhone X.

![alt text](images/2018-06-24-12.08.18.png)

* El segundo GUID corresponde con la aplicación.

## Extraer la BBDD del emulador

Al igual que la manera con la que extraigo una BBDD de SQLite de un emulador Android es algo "rebuscada" en macOS con emulador/ simulador iOS es tan sencillo como copiar y pegar desde Finder o terminal el archivo que se encuentra en la ruta a una ruta local.

```bash
cp /Users/mookiefumi/Library/Developer/CoreSimulator/Devices/A4450735-90FA-49F5-98AB-B35DB54A6894/data/Containers/Data/Application/54E45B15-3E6A-4C38-BBB0-FA5CC2EC2F7C/Documents/../Library/MyDatabase.db MyDatabase.db
```