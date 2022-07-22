# Prepare assets to deploy
Before deploying the app to Firebase Hosting, run `ionic build --prod`

# Multiple Environments with Firebase
For managing one site across different environments, we recommend multiple projects for promoting best practices of each environment having its own set of Firebase resources.

For example for this repo we will have two firebase projects:
- dev-ion4fullpwa
- ion4fullpwa

## Check available alias
Before deploying to Firebase Hosting make sure you are using the correct alias (dev, prod)
`firebase use` will list all the alias available
```
* dev (dev-ion4fullpwa)
  prod (ion4fullpwa)
  pro (pro-ion4fullpwa)
```

## Create alias
If you don't see these alias (dev, prod), you should create them
`firebase use --add`
```
? Which project do you want to add? ion4fullpwa
? What alias do you want to use for this project? (e.g. staging) prod
```

## Select alias (switching environments)
`firebase use dev`

You can also use the `-P` flag to specify an alias like this:
``` bash
firebase deploy --only hosting -P dev
```

This will deploy to the `dev` alias/environment

## Serve and test your Firebase project locally
For more info see: https://firebase.google.com/docs/hosting/deploying
`firebase serve --only hosting`

---

# [Advanced uses](https://firebase.google.com/docs/cli/targets#deploy-target-commands)

## [Create target](https://firebase.google.com/docs/cli/targets#set-up-deploy-target-hosting)
- TARGET_NAME = ionic-5
- RESOURCE_IDENTIFIER (the SITE_ID) = dev-ion4fullpwa
``` bash
firebase target:apply hosting ionic-5 dev-ion4fullpwa -P dev
```

- TARGET_NAME = ionic-6
- RESOURCE_IDENTIFIER (the SITE_ID) = dev-ionic-6-full-app
``` bash
firebase target:apply hosting ionic-6 dev-ionic-6-full-app -P dev
```

- TARGET_NAME = 12-2021-release
- RESOURCE_IDENTIFIER (the SITE_ID) = pro-ion4fullpwa
``` bash
firebase target:apply hosting 12-2021-release pro-ion4fullpwa -P pro
```

- TARGET_NAME = 06-2022-release
- RESOURCE_IDENTIFIER (the SITE_ID) = pro-ionic-6-full-app
``` bash
firebase target:apply hosting 06-2022-release pro-ionic-6-full-app -P pro
```


## [Configure your `firebase.json` file to use deploy targets](https://firebase.google.com/docs/cli/targets#configure_your_firebasejson_file_to_use_deploy_targets)
Don't forget to configure this before deploying to the new target


## Deploy to specific target (i.e.: different site)
``` bash
firebase deploy --only hosting:ionic-6 -P dev
```

``` bash
firebase deploy --only hosting:06-2022-release -P pro
```


## Create channel
- CHANNEL_ID = dev
``` bash
firebase hosting:channel:deploy dev --only ionic-6 -P dev
```
