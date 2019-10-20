---
layout: post
title: Unit testing tools using your MacOS terminal
published: false
---

## Unit testing tools using your MacOS terminal

I´ve been a MacOS user for many years and I ´ve been working with **Visual Studio for Mac** & **Mono Studio** and let me say that the tooling to work with unit testing is not enough so I had to include new tools.

When I run my tests in a terminal window or in Visual Studio for Mac, the only information the give me it´s the final test result:

```bash
dotnet test NBAStats.Core.Test.csproj

Starting test execution, please wait...

A total of 1 test files matched the specified pattern.

Test Run Successful.
Total tests: 11
     Passed: 11
 Total time: 1.4090 Seconds
```

So how can we get more information about our testing?

There are some "new" tools that help us to get more information like:

### Coverlet

Coverlet is a cross platform code coverage framework for .NET, with support for line, branch and method coverage. It works with .NET Framework on Windows and .NET Core on all supported platforms.

<https://github.com/tonerdo/coverlet>

It has different integrations, VsTest, MSBuild and Global tool but let me show you the MSBuild integratoin.

We have to include the **coverlet.msbuild** package in the test project so now we can execute the unit test collecting code coverage data.

```bash
dotnet test NBAStats.Core.Test.csproj /p:CollectCoverage=true

Starting test execution, please wait...

A total of 1 test files matched the specified pattern.

Test Run Successful.
Total tests: 11
     Passed: 11
 Total time: 1.4193 Seconds

Calculating coverage result...

+---------------+--------+--------+--------+
| Module        | Line   | Branch | Method |
+---------------+--------+--------+--------+
| NBAStats.Core | 20.44% | 14.78% | 20.12% |
+---------------+--------+--------+--------+

+---------+--------+--------+--------+
|         | Line   | Branch | Method |
+---------+--------+--------+--------+
| Total   | 20.44% | 14.78% | 20.12% |
+---------+--------+--------+--------+
| Average | 20.44% | 14.78% | 20.12% |
+---------+--------+--------+--------+
```

Coverlet has multiple interesting options but by favorite one is to indicate the report output format because it´s compatible with 

### ReportGenerator







The choosen tool is not an IDE, it's and editor. **Visual Studio Code** helps me to code my .Net Standard projects and of course to cover them with unit testing. But the work is easy with some amainzing extensions that give me more information like code coverage.

### VSCode Extensions

#### .NET Core Test Explorer

It´s a VSCode´s extension that allow us to see our available tests in a window with a treeview splitted by namespace. I have configure the next params:

* **Test Project Path**, in the current example I added "**/*.Test.csproj".
* As well I usually Add **Test Arguments** in order to generate code coverage info in lcov format that it´s compatible with the Coverage Gutters extension, in the current example I added "/p:CollectCoverage=true /p:CoverletOutputFormat=lcov /p:CoverletOutput=../coverage/lcov.info".

#### Coverage Gutters

It´s a VSCode´s extension that allow us to check the test coverage generated and works with many languages so also works with C#. It´s useful to activate the "Show Line Coverage" and "Show Gutter Coverage" options.

The extension expects to find a file called "lcov.info" so if we don´t run the tests without the previous params it will not work.
