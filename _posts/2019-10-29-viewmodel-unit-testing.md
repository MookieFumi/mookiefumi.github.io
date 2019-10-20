---
layout: post
title: ViewModel unit testing
published: false
---

## ViewModel unit testing

The unit testing is required and it´s not negotiated, we´ve been applying new design patterns in order to have the choice to test (*in this case*) our ViewModels so we don´t have more excuses.

We are going to use a LoginPage example, it´s a simple one (enough, i hope) and it will help us to show you how you can do it.

What are the main parts of my ViewModels I usually cover with unit testing?

* Code that have *business logic o presentation logic*, for example, enable or not a buttom when depends on a property value.

    E.g.: The login button is not enable until the username and password have value.

* To ensure the navigation between ViewModels.

    E.g.: The login is valid so the app should navigate to the MainPage.

* To ensure that the services receive the expected parameters from the ViewModel.

    E.g.: We call the Login method (LoginService) with the right parameters (Username/ password properties of the ViewModel).

* To ensure the behaviour when an exception ocurrs.

    E.g.: How our ViewModels handle with exceptions?

I have in my tool belt some nuget packages that helps me.

* **XUnit**. A free unit testing tool.
* **Fluent Assertions**. A set of extensions methods that allow you to more naturally specify the expected assert.
* **Moq**. A framework to work with test doubles.

Let me share with you some pieces of my unit tests.

```csharp
[Fact]
public void Execute_LoginCommand_If_Username_And_Password_Are_Not_Empty_And_Null()
{
    _sut.Username = "Not empty value";
    _sut.Password = "Not empty value";

    var result = _sut.LoginCommand.CanExecute(null);

    result.Should().BeTrue();
}

[Fact]
public async Task Call_LoginService_Login_Method_With_Properly_Params()
{
    _sut.Username = "Not empty value";
    _sut.Password = "Not empty value";

    await _sut.LoginCommand.ExecuteAsync();

    _loginService.Verify(m => m.Login(It.Is<LoginRequestDTO>(p =>
        p.Username == _sut.Username &&
        p.Password == _sut.Password )));
}

[Fact]
public async Task NavigateTo_MyTabbedPage_If_Login_Is_Valid()
{
    _sut.Username = "Not empty value";
    _sut.Password = "Not empty value";

    await _sut.LoginCommand.ExecuteAsync();

    NavigationService.Verify(m => m.NavigateAsync($"/{nameof(MyTabbedPage)}"), times: Times.Once);
}

[Fact]
public async Task Show_Toast_If_Login_Is_NotValid()
{
    _sut.Username = "aaanother@username";
    _sut.Password = _loginRequest.Password;

    await _sut.LoginCommand.ExecuteAsync();

    UserDialogs.Verify(m => m.Toast("Invalid login, please try it again", null), Times.Once);
}
```


### Terminal/ command line commands

How to run our tests collecting coverage and exporting to lcov format.

```bash
dotnet test src/NBAStats.Core.Test/NBAStats.Core.Test.csproj /p:CollectCoverage=true /p:CoverletOutputFormat=lcov /p:CoverletOutput=../coverage/lcov.info
```

How to run our tests collecting coverage and exporting to opencover format.

```bash
dotnet test src/NBAStats.Core.Test/NBAStats.Core.Test.csproj /p:CollectCoverage=true /p:CoverletOutput=../coverage/ /p:CoverletOutputFormat=opencover
```

How to generate a report in HTML format of our code coverage

```bash
reportgenerator "-reports:src/coverage/*.xml" "-reporttypes:HTMLInline" "-targetdir:src/coverage/report"
```

### VSCode configuration

#### Required extensions


```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "test (coverage)",
            "command": "dotnet",
            "type": "process",
            "args": [
                "test",
                "/p:CollectCoverage=true",
                "/p:CoverletOutputFormat=lcov",
                "/p:CoverletOutput=../coverage/lcov.info",
                "${workspaceFolder}/NBAStats.Core.Test/NBAStats.Core.Test.csproj"
            ],
            "problemMatcher": "$msCompile",
            "group": {
                "kind": "test",
                "isDefault": true
            }
        }
    ]
}
```
