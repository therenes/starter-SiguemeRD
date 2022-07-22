import { Inject, Injectable, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, Platform } from '@ionic/angular';

import { Observable, Subject, of } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import { AuthProvider, FacebookAuthProvider, GoogleAuthProvider, TwitterAuthProvider, OAuthProvider, OAuthCredential, UserCredential, createUserWithEmailAndPassword, getAuth, getRedirectResult, signInWithCredential, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut } from '@angular/fire/auth';

import type {
  AuthCredential as FirebaseAuthCredential,
  User as FirebaseUser,
} from '@angular/fire/auth';

import { AuthCredential, AuthStateChange, FirebaseAuthentication, SignInResult, User } from '@capacitor-firebase/authentication';

import { DataStore } from '../../shell/data-store';
import { FirebaseProfileModel } from './profile/firebase-profile.model';
import { SignInProvider } from './firebase-auth-definitions';


@Injectable({
  providedIn: 'root'
})
export class FirebaseAuthService implements OnDestroy {
  currentUser: User;
  authLoader: HTMLIonLoadingElement;
  profileDataStore: DataStore<FirebaseProfileModel>;
  redirectResultSubject: Subject<any> = new Subject<any>();
  authStateSubject: Subject<AuthStateChange> = new Subject<AuthStateChange>();

  constructor(
    public router: Router,
    public route: ActivatedRoute,
    public platform: Platform,
    private ngZone: NgZone,
    public loadingController: LoadingController,
    public location: Location,
    @Inject(PLATFORM_ID) private platformId: object
  ) {
    if (isPlatformBrowser(this.platformId)) {
      FirebaseAuthentication.removeAllListeners().then(() => {
        FirebaseAuthentication.addListener('authStateChange', (change: AuthStateChange) => {
          this.ngZone.run(() => {
            this.authStateSubject.next(change);
          });

          if (change?.user) {
            // ? User is signed in.
            this.currentUser = change.user;
          } else {
            // ? No user is signed in.
            this.currentUser = null;
          }
        });
      });

      // ? We should only listen for firebase auth redirect results when we have the flag 'auth-redirect' in the query params
      this.route.queryParams.subscribe(params => {
        const authProvider = params['auth-redirect'];

        if (authProvider) {
          // ? Show a loader while we receive the getRedirectResult notification
          this.presentLoading(authProvider);

          // ? When using signInWithRedirect, this listens for the redirect results
          const auth = getAuth();
          getRedirectResult(auth)
          .then((result: UserCredential) => {
            // ? result.credential.accessToken gives you the Provider Access Token. You can use it to access the Provider API.
            // const credential = FacebookAuthProvider.credentialFromResult(result);
            // const token = credential.accessToken;

            let credential: any;

            if (result && result !== null) {
              switch (result.providerId) {
                case SignInProvider.apple:
                  credential = OAuthProvider.credentialFromResult(result);
                  break;
                case SignInProvider.facebook:
                  credential = FacebookAuthProvider.credentialFromResult(result);
                  break;
                case SignInProvider.google:
                  credential = GoogleAuthProvider.credentialFromResult(result);
                  break;
                case SignInProvider.twitter:
                  credential = TwitterAuthProvider.credentialFromResult(result);
                  break;
              }

              const signInResult = this.createSignInResult(result.user, credential);

              this.dismissLoading();

              this.redirectResultSubject.next(signInResult);
            } else {
              throw new Error('Could not get user from redirect result');
            }
          }, (reason) => {
            console.log('Promise rejected', reason);

            // ? Clear redirection loading
            this.clearAuthWithProvidersRedirection();
          }).catch((error) => {
            // ? Clear redirection loading
            this.clearAuthWithProvidersRedirection();

            // ? Handle Errors here
            // const errorCode = error.code;
            // const errorMessage = error.message;
            // ? The email of the user's account used.
            // const email = error.email;
            // ?AuthCredential type that was used.
            // const credential = FacebookAuthProvider.credentialFromError(error);

            let errorResult = {error: 'undefined'};

            if (error && (error.code || error.message)) {
              errorResult = {error: (error.code ? error.code : error.message)};
            }

            this.redirectResultSubject.next(errorResult);
          });
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.dismissLoading();
  }

  public async signOut(): Promise<string> {
    const signOutPromise = new Promise<string>((resolve, reject) => {
      // * 1. Sign out on the native layer
      FirebaseAuthentication.signOut()
      .then((nativeResult) => {
        // * 2. Sign out on the web layer
        const auth = getAuth();
        signOut(auth)
        .then((webResult) => {
          // ? Sign-out successful
          resolve('Successfully sign out from native and web');
        }).catch((webError) => {
          // ? An error happened
          reject(`Web auth sign out error: ${webError}`);
        });
      })
      .catch((nativeError) => {
        reject(`Native auth sign out error: ${nativeError}`);
      });
    });

    return signOutPromise;
  }

  private async socialSignIn(provider: AuthProvider, scopes?: Array<string>): Promise<SignInResult> {
    this.presentLoading(provider.providerId);

    let authResult: SignInResult = null;

    if (this.platform.is('capacitor')) {
      authResult = await this.nativeAuth(provider, scopes);
    } else {
      authResult = await this.webAuth(provider);
    }

    this.dismissLoading();

    if (authResult !== null) {
      return authResult;
    } else {
      return Promise.reject('Could not perform social sign in, authResult is null');
    }
  }

  private prepareForAuthWithProvidersRedirection(authProviderId: string): void {
    // ? Before invoking auth provider redirect flow, add a flag to the path.
    // ? The presence of the flag in the path indicates we should wait for the auth redirect to complete
    this.location.replaceState(this.location.path(), 'auth-redirect=' + authProviderId, this.location.getState());
  }

  private clearAuthWithProvidersRedirection(): void {
    // ? Remove auth-redirect param from url
    this.location.replaceState(this.router.url.split('?')[0], '');
    this.dismissLoading();
  }

  private async presentLoading(authProviderId?: string): Promise<void> {
    const authProviderCapitalized = authProviderId[0].toUpperCase() + authProviderId.slice(1);

    this.loadingController.create({
      message: authProviderId ? 'Signing in with ' + authProviderCapitalized : 'Signing in ...',
      duration: 4000
    }).then((loader) => {
      this.authLoader = loader;
      this.authLoader.present();
    });
  }

  private async dismissLoading(): Promise<void> {
    if (this.authLoader) {
      await this.authLoader.dismiss();
    }
  }

  private async webAuth(provider: AuthProvider, scopes?: Array<string>): Promise<SignInResult> {
    // ? Scopes for Firebase JS SDK auth
    if (scopes) {
      let providerWithScopes: any;

      switch (provider.providerId) {
        case SignInProvider.apple:
          providerWithScopes = (provider as OAuthProvider);
          break;
        case SignInProvider.facebook:
          providerWithScopes = (provider as FacebookAuthProvider);
          break;
        case SignInProvider.google:
          providerWithScopes = (provider as GoogleAuthProvider);
          break;
        case SignInProvider.twitter:
          providerWithScopes = (provider as TwitterAuthProvider);
          break;
      }

      scopes.forEach(scope => {
        providerWithScopes.addScope(scope);
      });

      provider = providerWithScopes;
    }

    const auth = getAuth();
    let webAuthUserCredential: UserCredential = null;

    if (this.platform.is('desktop')) {
      webAuthUserCredential = await signInWithPopup(auth, provider);
    } else {
      // ? Web but not desktop, for example mobile PWA
      this.prepareForAuthWithProvidersRedirection(provider.providerId);
      return signInWithRedirect(auth, provider);

      // ? If you prefer to use signInWithPopup in every scenario, just un-comment this line
      // webAuthUserCredential = await signInWithPopup(auth, provider);
    }

    if (webAuthUserCredential && webAuthUserCredential !== null) {
      let webCredential: OAuthCredential = null;

      switch (provider.providerId) {
        case SignInProvider.apple:
          webCredential = OAuthProvider.credentialFromResult(webAuthUserCredential);
          break;
        case SignInProvider.facebook:
          webCredential = FacebookAuthProvider.credentialFromResult(webAuthUserCredential);
          break;
        case SignInProvider.google:
          webCredential = GoogleAuthProvider.credentialFromResult(webAuthUserCredential);
          break;
        case SignInProvider.twitter:
          webCredential = TwitterAuthProvider.credentialFromResult(webAuthUserCredential);
          break;
      }

      return this.createSignInResult(webAuthUserCredential.user, webCredential);
    } else {
      return Promise.reject('null webAuthUserCredential');
    }
  }

  private async nativeAuth(provider: AuthProvider, scopes?: Array<string>): Promise<SignInResult> {
    let nativeAuthResult: SignInResult = null;

    // ? Scopes for Firebase native SDK (iOS and Android)
    // TODO: Scopes for Firebase native SDK auth is a work in progress yet
    // (see: https://github.com/robingenz/capacitor-firebase/issues/32)


    // * 1. Sign in on the native layer
    switch (provider.providerId) {
      case SignInProvider.apple:
        nativeAuthResult = await FirebaseAuthentication.signInWithApple();
        break;
      case SignInProvider.facebook:
        nativeAuthResult = await FirebaseAuthentication.signInWithFacebook();
        break;
      case SignInProvider.google:
        nativeAuthResult = await FirebaseAuthentication.signInWithGoogle();
        break;
      case SignInProvider.twitter:
        nativeAuthResult = await FirebaseAuthentication.signInWithTwitter();
        break;
    }

    // ? Once we have the user authenticated on the native layer, authenticate it in the web layer
    if (nativeAuthResult && nativeAuthResult !== null) {
      const auth = getAuth();
      let nativeCredential: OAuthCredential = null;

      switch (provider.providerId) {
        case SignInProvider.apple:
          const provider = new OAuthProvider(SignInProvider.apple);
          nativeCredential = provider.credential({
            idToken: nativeAuthResult.credential?.idToken,
            rawNonce: nativeAuthResult.credential?.nonce
          });
          break;
        case SignInProvider.facebook:
          nativeCredential = FacebookAuthProvider.credential(
            nativeAuthResult.credential?.accessToken
          );
          break;
        case SignInProvider.google:
          nativeCredential = GoogleAuthProvider.credential(nativeAuthResult.credential?.idToken, nativeAuthResult.credential?.accessToken);
          break;
        case SignInProvider.twitter:
          try {
            nativeCredential = TwitterAuthProvider.credential(nativeAuthResult.credential?.accessToken, nativeAuthResult.credential?.secret);
            break;
          } catch (error) {
            console.error(error);
          }
      }

      // * 2. Sign in on the web layer using the access token we got from the native sign in
      const webAuthResult = await signInWithCredential(auth, nativeCredential);

      return this.createSignInResult(webAuthResult.user, nativeCredential);
    } else {
      return Promise.reject('null nativeAuthResult');
    }
  }

  public async signInWithFacebook(): Promise<SignInResult> {
    const provider = new FacebookAuthProvider();
    const scopes = ['email'];

    // ? When we use the redirect authentication flow, the code below the socialSignIn() invocation does not get executed as we leave the current page
    return this.socialSignIn(provider, scopes);
  }

  public async signInWithGoogle(): Promise<SignInResult> {
    const provider = new GoogleAuthProvider();
    const scopes = ['profile', 'email'];

    // ? When we use the redirect authentication flow, the code below the socialSignIn() invocation does not get executed as we leave the current page
    return this.socialSignIn(provider, scopes);
  }

  public async signInWithTwitter(): Promise<SignInResult> {
    const provider = new TwitterAuthProvider();
    const scopes = ['name', 'email'];

    // ? When we use the redirect authentication flow, the code below the socialSignIn() invocation does not get executed as we leave the current page
    return this.socialSignIn(provider, scopes);
  }

  public async signInWithApple(): Promise<SignInResult> {
    const provider = new OAuthProvider('apple.com');
    const scopes = ['name', 'email'];

    // ? When we use the redirect authentication flow, the code below the socialSignIn() invocation does not get executed as we leave the current page
    return this.socialSignIn(provider, scopes);
  }

  public async signInWithEmail(email: string, password: string): Promise<SignInResult> {
    // ? Show a loader while we attempt to perform the login
    this.presentLoading('email');

    const auth = getAuth();
    const credential = await signInWithEmailAndPassword(auth, email, password);

    this.dismissLoading();

    return this.createSignInResultFromUserCredential(credential);
  }

  public async signUpWithEmail(email: string, password: string): Promise<SignInResult> {
    // ? Show a loader while we attempt to perform the signup
    this.presentLoading('email');

    const auth = getAuth();
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    this.dismissLoading();

    return this.createSignInResultFromUserCredential(credential);
  }

  public get redirectResult$(): Observable<any> {
    return this.redirectResultSubject.asObservable();
  }

  public get authState$(): Observable<AuthStateChange> {
    return this.authStateSubject.asObservable();
  }

  public getProfileDataSource(): Observable<FirebaseProfileModel> {
    const auth = getAuth();
    return of(auth.currentUser)
    .pipe(
      filter((user: FirebaseUser) => user != null),
      map((user: FirebaseUser) => {
        const userResult = this.createUserResult(user);
        return this.setUserModelForProfile(userResult);
      })
    );
  }

  private setUserModelForProfile(userResult?: (User | null)): FirebaseProfileModel {
    const userModel = new FirebaseProfileModel();

    if (userResult) {
      userModel.image = this.getPhotoURL(userResult.providerId, userResult.photoUrl);
      userModel.name = userResult.displayName || 'What\'s your name?';
      userModel.role = 'How would you describe yourself?';
      userModel.description = 'Anything else you would like to share with the world?';
      userModel.phoneNumber = userResult.phoneNumber || 'Is there a number where I can reach you?';
      userModel.email = userResult.email || 'Where can I send you emails?';
      userModel.provider = (userResult.providerId !== 'password') ? userResult.providerId : 'Credentials';
    }

    return userModel;
  }

  public getProfileStore(dataSource: Observable<FirebaseProfileModel>): DataStore<FirebaseProfileModel> {
    // ? Initialize the model specifying that it is a shell model
    const shellModel: FirebaseProfileModel = new FirebaseProfileModel();
    this.profileDataStore = new DataStore(shellModel);
    // ? Trigger the loading mechanism (with shell) in the dataStore
    this.profileDataStore.load(dataSource);
    return this.profileDataStore;
  }

  private getPhotoURL(signInProviderId: string, photoURL: string): string {
    // ? Default imgs are too small and our app needs a bigger image
    switch (signInProviderId) {
      case SignInProvider.facebook:
        return photoURL + '?height=400';
      case SignInProvider.twitter:
        return photoURL.replace('_normal', '_400x400');
      case SignInProvider.google:
        return photoURL.split('=')[0];
      case 'password':
        return 'https://s3-us-west-2.amazonaws.com/ionicthemes/otros/avatar-placeholder.png';
      default:
        return photoURL;
    }
  }

  // * Aux methods inspired on the @capacitor-firebase/authentication library

  // (see: https://github.com/robingenz/capacitor-firebase/blob/a51927ff3acce94cedcd7bfc218952bb106db904/packages/authentication/src/web.ts#L297)
  private createSignInResultFromUserCredential(credential: UserCredential): SignInResult {
    const userResult = this.createUserResult(credential.user);
    const result: SignInResult = {
      user: userResult,
      credential: null,
    };
    return result;
  }

  private createSignInResult(user: FirebaseUser, credential: FirebaseAuthCredential | null): SignInResult {
    const userResult = this.createUserResult(user);
    const credentialResult = this.createCredentialResult(credential);
    const result: SignInResult = {
      user: userResult,
      credential: credentialResult,
    };
    return result;
  }

  private createUserResult(user: FirebaseUser | null): User | null {
    if (!user) {
      return null;
    }
    const result: User = {
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      isAnonymous: user.isAnonymous,
      phoneNumber: user.phoneNumber,
      photoUrl: user.photoURL,
      providerId: user.providerId,
      tenantId: user.tenantId,
      uid: user.uid,
    };
    return result;
  }

  private createCredentialResult(credential: FirebaseAuthCredential | null): AuthCredential | null {
    if (!credential) {
      return null;
    }
    const result: AuthCredential = {
      providerId: credential.providerId,
    };
    if (credential instanceof OAuthCredential) {
      result.accessToken = credential.accessToken;
      result.idToken = credential.idToken;
      result.secret = credential.secret;
    }
    return result;
  }
}
