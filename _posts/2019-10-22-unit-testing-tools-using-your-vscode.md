---
layout: post
title: Unit testing tools using VSCode
published: true
---

## Unit testing tools using VSCode

This post is the second part of the post [Unit testing tools using your MacOS terminal](http://mookiefumi.com/2019-10-20-unit-testing-tools-using-your-MacOS-terminal). They are related because the topic it´s the unit testing and the tools we have mainly in MacOS (they existing in Windows/ Linux enviroments too).

Since I´ve been developing .Net Standard libraries I had to include a new tool in my tool belt, but this time, it wasn´t a new IDE. The choosen tool was an editor. **Visual Studio Code** helps me to code my .Net Standard projects and of course to cover them with unit testing and with some amainzing extensions that give me more information like code coverage.

### VSCode Extensions

#### .NET Core Test Explorer

It´s a VSCode´s extension that allow us to see our available tests in a window with a treeview splitted by namespace. I have configured the next parameters:

* **Test Project Path**, in the current example I added "**/*.Test.csproj".
* As well, I usually add **Test Arguments** in order to generate code coverage info in lcov format that it´s compatible with the Coverage Gutters extension, in the current example I added: *"/p:CollectCoverage=true /p:CoverletOutputFormat=lcov /p:CoverletOutput=../coverage/lcov.info"*.

Once the extension is installed you'll see a new icon in the right toolbar called Test and if you click on it you´ll see the available unit tests grouped by namespace.

> From here you can run the tests of every tree node.

![.Net Core Test Explorer](images/Screenshot2019-10-20_21.42.43.png)

#### Coverage Gutters

It´s a VSCode´s extension that allow us to check the test coverage generated and works with many languages so also works with C#. It´s useful to activate the "Show Line Coverage" and "Show Gutter Coverage" options.

The extension expects to find a file called "lcov.info" so if we don´t run the tests without the previous params it will not work.

> With these configured tools everytime you open a file in the solution you'll see the lines covered.

![.Net Core Test Explorer](images/Screenshot2019-10-20_21.44.40.png)

If you execute the ReportGenerator tool to convert the generated code coverage report in lcov format to Html you can open it directly from the VSCode command palette: **Coverage Gutters - Preview Coverage Report** and you'll see the report integrated in VSCode.

```bash
reportgenerator "-reports:src/coverage/*.xml" "-reporttypes:HTMLInline" "-targetdir:src/coverage/report"
```

![.Preview Coverage Report](images/Screenshot2019-10-20_21.55.56.png)

> You can run or debug your unit testing from VSCode so it´s interesting if you are bored/ tired of your daily use IDE.
