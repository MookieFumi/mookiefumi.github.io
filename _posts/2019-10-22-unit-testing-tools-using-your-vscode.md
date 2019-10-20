---
layout: post
title: Unit testing tools using VSCode
published: false
---

## Unit testing tools using VSCode





The choosen tool is not an IDE, it's and editor. **Visual Studio Code** helps me to code my .Net Standard projects and of course to cover them with unit testing. But the work is easy with some amainzing extensions that give me more information like code coverage.

### VSCode Extensions

#### .NET Core Test Explorer

It´s a VSCode´s extension that allow us to see our available tests in a window with a treeview splitted by namespace. I have configure the next params:

* **Test Project Path**, in the current example I added "**/*.Test.csproj".
* As well I usually Add **Test Arguments** in order to generate code coverage info in lcov format that it´s compatible with the Coverage Gutters extension, in the current example I added "/p:CollectCoverage=true /p:CoverletOutputFormat=lcov /p:CoverletOutput=../coverage/lcov.info".

#### Coverage Gutters

It´s a VSCode´s extension that allow us to check the test coverage generated and works with many languages so also works with C#. It´s useful to activate the "Show Line Coverage" and "Show Gutter Coverage" options.

The extension expects to find a file called "lcov.info" so if we don´t run the tests without the previous params it will not work.