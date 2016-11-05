---
layout: post
title: Https en nuestra WebApi
subtitle: Pasos a seguir para tener HTTPS en nuestra WebApi
published: true
---

Ultimamente estamos desarrollando una WebApi que va a servir de backend a una aplicación móvil desarrollada en Xamarin y uno de los aspectos que más nos preocupaba era la securización de la misma ya que el método de autenticación es autenticación básica, es decir, el nombre de usuario y la contraseña viajan en texto plano (_Base64_). De hecho la recomendación es usar sólo autenticación básica con HTTPS.

### ¿Qué significa Https? 
La definición exacta es protocolo seguro de transferencia de hipertexto (_**Hypertext Transfer Protocol Secure**_) y según podemos leer en la [Wikipedia](https://es.wikipedia.org/wiki/Hypertext_Transfer_Protocol_Secure) utiliza un cifrado basado en SSL/ TLS para crear un canal cifrado. Siempre que entramos en cualquier página de un banco, de cualquier red social, etc. vemos en la barra de direcciones del nevegador un icono de un candado y en él podemos la información en sí del certificado.

<img src="images/https-info.png" alt="https" class="img-thumbnail"/>

Un certificado digital contiene por normal general, información del sitio web, información de identificación del emisor, el período de validez y una firma única. **Es esta última la que confirma que te estás comunicando con quien realmente te querías comunicar**. En la actualizad hay muchas autoridades de certificación, por ejemplo, VeriSign o la que hemos seleccionado nosotros GoDaddy. El motivo de la elección no ha sido otro que el sitio dónde tenemos contratados los dominios y por dejar en un único sitio este tipo de gestiones.

Para todo el proceso vamos a apoyarnos en una herramienta multiplaforma llamada [OpenSSL](https://www.openssl.org) que es un proyecto de software libre basado en SSLeay y desarrollado por Eric Young y Tim Hudson.

### Pasos a seguir

* Lo primero que nos solicita la entidad certificadora es crear una solicitud para firma de certificado (CSR), la cual contiene la siguiente información:
    * **Country**. El código ISO de dos letras para el país en el que se encuentra su organización.
    * **State/County/Region**. El estado/ región donde se encuentra su organización. No puede ser abreviado.
    * **City/Locality**. La ciudad dónde tu organización está ubicada.
    * **Organization**. El nombre legal de su organización.
    * **Organizational Unit**. El departamento de su organización que maneja el certificado.
    * **Common Name**. El nombre de dominio completo de su servidor. Debe coincidir exactamente con lo que escribe en su navegador web o recibirá un error de coincidencia de nombre.    
    * **Email address**. Una dirección de correo electrónico utilizada para ponerse en contacto con su organización. 
    * **Public Key.** La clave pública que entrará en el certificado se crea automáticamente.

```
openssl req -new -newkey rsa:2048 -nodes -out mycsr.csr -keyout mykey.key

Generating a 2048 bit RSA private key

Country Name (2 letter code) [AU]:                  ES
State or Province Name (full name) [Some-State]:    Madrid
Locality Name (eg, city) []:                        Alcobendas
Organization Name (eg, company):                    MookieFumi
Organizational Unit Name (eg, section) []:          Dev Team
Common Name (e.g. server FQDN or YOUR name) []:     mookiefumi.com
Email Address []:                                   mookiefumi@outlook.com

```

> EL CSR generado tiene una clave pública que concuerda ("coincide") con la clave privada.

* El siguiente paso es subir el CSR generado a la entidad certificadora, y es un proceso en el cual se confirman entre otros:
	* Propiedad de dominio. Verifica que tienes control sobre este dominio.
	* Cargar documentación. No siempre es necesario.

* Una vez que la entidad certificadora ha validado la propiedad del dominio (nunca me ha llevado más de 15 minutos) lo siguiente es descargarlo y el formato con el que se descarga no suele ser nunca el formato con el que debemos añadirlo en el IIS o en Azure (**PFX**). En el caso de GoDaddy lo hemos descargado para IIS y hemos recibido dos archivos:
    * my-crt-file.crt
    * my-p7b-file.p7b

> El formato **P7B/PKCS#7** sólo puede contener el certificado pero no la clave privada. Están codificados en Base64.

> El formato **PFX/PKCS#12** es usado para almacenar el certificado de servidor, cualquier certificado intermedio y la clave privada en un único archivo encriptado. Es un archivo binario. _**Típicamente usados en Windows para importar y exportar certificados y clave privadas**_.

* Convertir el certificado en formato P7B a PFX. Para convertir el certificado descargado al formato admitido por IIS o por Azure nos apoyamos de nuevo en OpenSSL.

```
openssl pkcs12 -export -in my-crt-file.crt -inkey mykey.key -out my-pfx.pfx

Enter Export Password:
Verifying - Enter Export Password:

```

* Subir nuestro archivo de certificado PFX a Azure y asignarlo a un Web App.
Para completar el proceso y tener nuestra WebApi trabajando sobre HTTPS en Azure simplemente deberemos ir a la sección de configuración y certificados SSL y desde ahí podremos realizar toda la gestión de los certificados.
    * Cargar un certificado. Podemos cargar un certificado adquirido externamente o importar un certificado de servicio de la aplicación.
    * Enlaces SSL. Será desde aquí donde asignemos nuestro certificado cargado con nuestra WebApi.

<img src="images/https-azure.png" alt="https" class="img-thumbnail"/>