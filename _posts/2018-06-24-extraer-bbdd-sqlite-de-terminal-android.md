---
layout: post
title: Extraer base de datos SQLite de un terminal Android
published: true
---

## Introducción

Tarde o temprano en el desarrollo de una aplicación móvil nos encontramos con la necesidad de persistir datos de manera local y una de las opciones que tenemos es SQLite. 

*No es buena práctica "persistir" todo el estado de nuestra app en clases estáticas ya que si la app hiciera crash en algún momento nos quedaríamos sin ningún dato.*

¿Qué beneficios tiene SQLite?
Es un motor de base de datos **auto-contenido** (sin dependencias externas), de **alta fiabilidad** (no da problemas, simplemente funciona), **embebido** (serverless- no hay un proceso de servidor intermediario), y **de dominio público** ya que es Open-Source (*no Open-Contribution*). Ah! Y no debemos perder de vista que es el más utilizado en todo el mundo.
[SQLite Home](https://www.sqlite.org)

## ¿Para qué quiero tener acceso desde macOS a la BBDD SQLite?

En mi caso, tengo la necesidad de confirmar que una importación de datos se ha realizado correctamente y a pesar de tenerlo cubierto con tests me ha picado la curiosidad poder extraer esa BBDD para poder observar los datos.

Otra de las motivaciones ha sido la necesidad de crear unas consultas sobre dicha BBDD y al no ser la misma sintáxis que en SQL Server, *sin ir más lejor la paginación cambia entre otras cosas*, me da algo de vértigo perder excesivo tiempo.

## ¿Cómo puedo extraer o ver la BBDD SQLite generada por mi app?

Voy a trabajar con un emulador pero el procedimiento sería exactamente el mismo que si lo hiciéramos sobre dispositivos físicos. Para ello vamos a hacer uso del comando **adb** que nos propociona el SDK de Android. Mi entorno de desarrollo es **macOS** y **Visual Studio for Mac** aunque si esto mismo lo seguimos en Windows entiendo que será exactamente igual.

### El comando adb (Android Debug Bridge).

Es un herramienta de línea de comandos que permite la comunicación con un dispositivo conectado, ya sea un terminal físico o un emulador.
[Android Debug Bridge](https://developer.android.com/studio/command-line/adb?hl=es-419)

### ¿Dónde se encuentra el comando adb?

Si abres un terminal y escribes **adb** lo lógico es que te encuentres con un *command not found* por lo que para utilizarlo tenemos tres opciones.

* La primera opción es situarnos en un terminal sobre el directorio dónde esté instalado el comando **adb**. Para ver la ruta dónde se encuentra instalado el SDK de Android deberemos ir a **Preferences -> Projects -> SDK Locations -> Locations**. En mi caso se encuentra en /*Users/mookiefumi/Library/Developer/Xamarin/android-sdk-macosx* y el comando **adb** está dentro del directorio **platform-tools**.

* La segunda opción es abrir el terminal desde **Tools -> SDK Command prompt**.

* La tercera opción y para mi la recomendada, es añadir el path del comando adb a nuestro bash profile.

```bash
PATH=$PATH:/Users/mookiefumi/Library/Developer/Xamarin/android-sdk-macosx/platform-tools
```

### Localizar nuestra BBDD SQLite y extraerla

Una vez habilitado el comando **adb** en nuestro terminal debemos asegurarnos que funciona correctamente y sobre todo que el dispositivo del que queremos extraer la BBDD SQLite lo tenemos disponible. Para ello:

```bash
mookiefumi@penguin:~$ adb devices


List of devices attached
emulator-5554	device
```

En mi caso el dispositivo adjunto es el "**emulator-5554**" y será sobre el que trabaje.

¿Dónde se encuentra la bbdd de nuestra aplicación? Este ejemplo es una aplicación **Xamarin Forms** y como las rutas varían en función de la plataforma dónde se ejecute esta configuración es específica y la tenemos en nuestro proyecto Android.

```csharp
public class SQLiteClient : ISQLiteClient
{
    public SQLiteAsyncConnection GetConnection()
    {
        var sqliteFilename = "MyDatabase.db";
        var path = System.Environment.GetFolderPath(System.Environment.SpecialFolder.Personal);
        ///data/user/0/com.company.product/files

        return new SQLiteAsyncConnection(Path.Combine(path, sqliteFilename));
    }
}
```

Haciendo uso del terminal vamos a enviar comandos al dispositivo que tenemos adjunto con el fin de obtener el fichero de base de datos, para ello:

* Ver que archivos se encuentran en el path del enumerado SpecialFolder.Personal:

```bash
adb -s emulator-5554 -d shell "run-as com.company.product ls /data/user/0/com.company.product/files/"

MyDatabase.db
appcenter
error
```

* Si intentamos hacer un pull del archivo directamente desde esta ubicación lo lógico en que tengamos **permission denied** por lo que tendremos que copiarlo a alguna carpeta que tengamos persmisos (*en este caso a sdcard*).

```bash
adb -s emulator-5554 -d shell "run-as com.company.product cp /data/user/0/com.company.product/files/MyDatabase.db /sdcard/"
```

* Por último enviamos a local (en este caso al macOS) este archivo haciendo uso del comando pull.

```bash
adb -s emulator-5554 pull /sdcard/MyDatabase.db

/sdcard/MyDatabase.db: 1 file pulled. 119.8 MB/s (23433216 bytes in 0.187s)
```
