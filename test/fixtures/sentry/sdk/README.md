# SDK fixture programs

Small programs that send two events (`type-error` with a cause, and `message`) with a real Sentry
SDK. `capture-sdk.ts` runs them against a local server and writes `<sdk>-<scenario>.json` in the
parent folder. The tests replay these requests exactly.

The SDKs are installed in a temporary folder (`$DEPS` below), not in this repository. Local paths
in the requests become `/app` (this repository) and `/deps` (the temporary folder).

Versions used for the committed fixtures: sentry-sdk 2.71.0 (Python 3.14), sentry-ruby 7.1.0
(Ruby 3.4), sentry/sentry 4.34.0 (PHP 8.5), sentry-go 0.50.0 (Go 1.27), Sentry 6.12.0 (.NET 10).

```sh
DEPS=$(mktemp -d); F=test/fixtures/sentry/sdk; C=test/fixtures/sentry/capture-sdk.ts

# Python: in-app frames are the ones under the working directory.
python3 -m venv $DEPS/py && $DEPS/py/bin/pip install sentry-sdk==2.71.0
CAPTURE_CWD=$F/python node $C python $DEPS $DEPS/py/bin/python $PWD/$F/python/capture.py

# Ruby: in-app frames are under lib/, app/, ... of the working directory.
gem install --install-dir $DEPS/gems sentry-ruby -v 7.1.0
CAPTURE_CWD=$F/ruby GEM_HOME=$DEPS/gems GEM_PATH=$DEPS/gems node $C ruby $DEPS ruby $PWD/$F/ruby/lib/capture.rb

# PHP
(cd $DEPS && composer require sentry/sentry:4.34.0)
node $C php $DEPS php $PWD/$F/php/capture.php

# Go
mkdir $DEPS/go && cp $F/go/main.go $DEPS/go && (cd $DEPS/go && go mod init fixture &&
  go get github.com/getsentry/sentry-go@v0.50.0 && go build -o fixture .)
node $C go $DEPS $DEPS/go/fixture

# .NET: a console project with <PackageReference Include="Sentry" Version="6.12.0" />
mkdir $DEPS/dotnet && cp $F/dotnet/Program.cs $DEPS/dotnet && (cd $DEPS/dotnet &&
  dotnet new console --force && dotnet add package Sentry --version 6.12.0 && dotnet build -o out)
node $C dotnet $DEPS dotnet $DEPS/dotnet/out/dotnet.dll
```

Before you commit new fixtures, decode them and check that they show nothing of your machine
(user names, home paths, host names). A change of a fixture changes the fingerprint snapshot:
check that the existing entries did not change.

Java is not recorded yet.
