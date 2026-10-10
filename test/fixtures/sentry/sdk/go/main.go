// Golden fixture program for the Sentry Go SDK. Run through capture-sdk.ts (see README.md).
package main

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/getsentry/sentry-go"
)

var errNoUser = errors.New("no such user")

func loadUser(id string) (map[string]string, error) {
	users := map[string]map[string]string{}
	user, ok := users[id]
	if !ok {
		return nil, fmt.Errorf("load user %s: %w", id, errNoUser)
	}
	return user, nil
}

func showProfile(id string) (string, error) {
	user, err := loadUser(id)
	if err != nil {
		return "", fmt.Errorf("failed to show profile: %w", err)
	}
	return user["name"], nil
}

func main() {
	err := sentry.Init(sentry.ClientOptions{
		Dsn:              os.Getenv("SENTRY_DSN"),
		Release:          "fixture-app@1.2.3",
		Environment:      "production",
		ServerName:       "fixture-host",
		AttachStacktrace: true,
	})
	if err != nil {
		panic(err)
	}
	if os.Getenv("FIXTURE_SCENARIO") == "type-error" {
		sentry.ConfigureScope(func(scope *sentry.Scope) {
			scope.SetTag("route", "/users/:id")
			scope.SetUser(sentry.User{ID: "user-42", Email: "ada@example.com"})
		})
		if _, err := showProfile("42"); err != nil {
			sentry.CaptureException(err)
		}
	} else {
		sentry.CaptureMessage("Cache miss rate above 90% for key user:1234")
	}
	sentry.Flush(5 * time.Second)
}
