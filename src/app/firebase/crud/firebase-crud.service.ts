import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';

import { Firestore, collection, collectionData, query, CollectionReference, orderBy, startAt, endAt, docData, doc, DocumentReference, where, setDoc, updateDoc, deleteDoc, getDoc, DocumentSnapshot } from '@angular/fire/firestore';

import { Observable, of, forkJoin, throwError, combineLatest, from } from 'rxjs';
import { map, concatMap, first, filter } from 'rxjs/operators';

import * as dayjs from 'dayjs';

import { DataStore, ShellModel } from '../../shell/data-store';
import { FirebaseListingItemModel } from './../crud/listing/firebase-listing.model';
import { FirebaseCombinedUserModel, FirebaseSkillModel, FirebaseUserModel } from './../crud/user/firebase-user.model';
import { UserImageModel } from './../crud/user/select-image/user-image.model';
import { TransferStateHelper } from '../../utils/transfer-state-helper';

@Injectable({
  providedIn: 'root'
})
export class FirebaseCrudService {
  // ? Listing Page
  private listingDataStore: DataStore<Array<FirebaseListingItemModel>>;
  // ? User Details Page
  private combinedUserDataStore: DataStore<FirebaseCombinedUserModel>;
  private relatedUsersDataStore: DataStore<Array<FirebaseListingItemModel>>;
  // ? Select User Image Modal
  private avatarsDataStore: DataStore<Array<UserImageModel>>;

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private transferStateHelper: TransferStateHelper,
    private firestore: Firestore
  ) {}

  // * Firebase User Listing Page
  public getListingDataSource(): Observable<Array<FirebaseListingItemModel>> {
    const rawDataSource: Observable<Array<FirebaseListingItemModel>> = collectionData<FirebaseListingItemModel>(
      query<FirebaseListingItemModel>(
        collection(this.firestore, 'users') as CollectionReference<FirebaseListingItemModel>
      ), { idField: 'id' }
    )
    .pipe(
      map((users: Array<FirebaseListingItemModel>) => {
        return users.map((user: FirebaseListingItemModel) => {
          const age = this.calcUserAge(user.birthdate);

          return { age, ...user } as FirebaseListingItemModel;
        });
      })
    );

    // This method taps into the raw data source and stores the resolved data in the TransferState, then when
    // transitioning from the server rendered view to the browser, checks if we already loaded the data in the server to prevent
    // duplicate http requests.
    const cachedDataSource = this.transferStateHelper.checkDataSourceState('firebase-listing-state', rawDataSource);

    return cachedDataSource;
  }

  public getListingStore(dataSource: Observable<Array<FirebaseListingItemModel>>): DataStore<Array<FirebaseListingItemModel>> {
    // Use cache if available
    if (!this.listingDataStore) {
      // Initialize the model specifying that it is a shell model
      const shellModel: Array<FirebaseListingItemModel> = [
        new FirebaseListingItemModel(),
        new FirebaseListingItemModel(),
        new FirebaseListingItemModel(),
        new FirebaseListingItemModel(),
        new FirebaseListingItemModel(),
        new FirebaseListingItemModel()
      ];
      this.listingDataStore = new DataStore(shellModel);

      // If running in the server, then don't add shell to the Data Store
      // If we already loaded the Data Source in the server, then don't show a shell when transitioning back to the browser from the server
      if (isPlatformServer(this.platformId) || dataSource['ssr_state']) {
        // Trigger loading mechanism with 0 delay (this will prevent the shell to be shown)
        this.listingDataStore.load(dataSource, 0);
      } else { // On browser transitions
        // Trigger the loading mechanism (with shell)
        this.listingDataStore.load(dataSource);
      }
    }

    return this.listingDataStore;
  }

  // * Filter users by age
  public searchUsersByAge(lower: number, upper: number): Observable<Array<FirebaseListingItemModel>> {
    // ? We save the dateOfBirth in our DB so we need to calc the min and max dates valid for this query
    const minDate = (dayjs(Date.now()).subtract(upper, 'year')).unix();
    const maxDate =  (dayjs(Date.now()).subtract(lower, 'year')).unix();

    const filteredDataSource: Observable<Array<FirebaseListingItemModel>> = collectionData<FirebaseListingItemModel>(
      query<FirebaseListingItemModel>(
        collection(this.firestore, 'users') as CollectionReference<FirebaseListingItemModel>,
        orderBy('birthdate'),
        startAt(minDate),
        endAt(maxDate)
      ), { idField: 'id' }
    )
    .pipe(
      map((users: Array<FirebaseListingItemModel>) => {
        return users.map((user: FirebaseListingItemModel) => {
          const age = this.calcUserAge(user.birthdate);

          return { age, ...user } as FirebaseListingItemModel;
        });
      })
    );

    return filteredDataSource;
  }

  // * Firebase User Details Page
  // ? Concat the userData with the details of the userSkills (from the skills collection)
  public getCombinedUserDataSource(userId: string): Observable<FirebaseCombinedUserModel> {
    const rawDataSource = this.getUser(userId)
    .pipe(
      // Transformation operator: Map each source value (user) to an Observable (combineDataSources | throwError) which
      // is merged in the output Observable
      concatMap(user => {
        if (user && user.skills) {
          // Map each skill id and get the skill data as an Observable
          const userSkillsObservables: Array<Observable<FirebaseSkillModel>> = user.skills.map((skillId: string) => {
            // ? first() emits the first value of the source Observable, then completes.
            return this.getSkill(skillId).pipe(first());
          });

          // Combination operator: Take the most recent value from both input sources (of(user) & forkJoin(userSkillsObservables)),
          // and transform those emitted values into one value ([userDetails, userSkills])
          return combineLatest([
            of(user),
            forkJoin(userSkillsObservables)
          ])
          .pipe(
            map(([userDetails, userSkills]: [FirebaseUserModel, Array<FirebaseSkillModel>]) => {
              // Spread operator (see: https://dev.to/napoleon039/how-to-use-the-spread-and-rest-operator-4jbb)
              return {
                ...userDetails,
                skills: userSkills
              } as FirebaseCombinedUserModel;
            })
          );
        } else {
          // Throw error
          return throwError(() => new Error('User does not have any skills.'));
        }
      })
    );

    // This method taps into the raw data source and stores the resolved data in the TransferState, then when
    // transitioning from the server rendered view to the browser, checks if we already loaded the data in the server to prevent
    // duplicate http requests.
    const cachedDataSource = this.transferStateHelper.checkDataSourceState(`firebase-user-${userId}-state`, rawDataSource);

    return cachedDataSource;
  }

  public getCombinedUserStore(dataSource: Observable<FirebaseCombinedUserModel>): DataStore<FirebaseCombinedUserModel> {
    // Initialize the model specifying that it is a shell model
    const shellModel: FirebaseCombinedUserModel = new FirebaseCombinedUserModel();
    this.combinedUserDataStore = new DataStore(shellModel);

    // If running in the server, then don't add shell to the Data Store
    // If we already loaded the Data Source in the server, then don't show a shell when transitioning back to the browser from the server
    if (isPlatformServer(this.platformId) || dataSource['ssr_state']) {
      // Trigger loading mechanism with 0 delay (this will prevent the shell to be shown)
      this.combinedUserDataStore.load(dataSource, 0);
    } else { // On browser transitions
      // Trigger the loading mechanism (with shell)
      this.combinedUserDataStore.load(dataSource);
    }

    return this.combinedUserDataStore;
  }

  // eslint-disable-next-line max-len
  public getRelatedUsersDataSource(combinedUserDataSource: Observable<FirebaseCombinedUserModel & ShellModel>, userId: string): Observable<Array<FirebaseListingItemModel>>  {
    const rawDataSource = combinedUserDataSource
    .pipe(
      // Filter user values that are not shells. We need to add this filter if using the combinedUserDataStore timeline
      filter(user => !user.isShell),
      concatMap(user => {
        if (user && user.skills) {
          // Get all users with at least 1 skill in common
          const relatedUsersObservable: Observable<Array<FirebaseListingItemModel>> =
          this.getUsersWithSameSkills(user.id, user.skills);

          return relatedUsersObservable;
        } else {
          // Throw error
          return throwError(() => new Error('Could not get related user'));
        }
      })
    );

    // This method taps into the raw data source and stores the resolved data in the TransferState, then when
    // transitioning from the server rendered view to the browser, checks if we already loaded the data in the server to prevent
    // duplicate http requests.
    const cachedDataSource = this.transferStateHelper.checkDataSourceState(`firebase-user-${userId}-related-users-state`, rawDataSource);

    return cachedDataSource;
  }

  public getRelatedUsersStore(dataSource: Observable<Array<FirebaseListingItemModel>>): DataStore<Array<FirebaseListingItemModel>> {
    // Initialize the model specifying that it is a shell model
    const shellModel: Array<FirebaseListingItemModel> = [
      new FirebaseListingItemModel(),
      new FirebaseListingItemModel(),
      new FirebaseListingItemModel()
    ];
    this.relatedUsersDataStore = new DataStore(shellModel);

    // If running in the server, then don't add shell to the Data Store
    // If we already loaded the Data Source in the server, then don't show a shell when transitioning back to the browser from the server
    if (isPlatformServer(this.platformId) || dataSource['ssr_state']) {
      // Trigger loading mechanism with 0 delay (this will prevent the shell to be shown)
      this.relatedUsersDataStore.load(dataSource, 0);
    } else { // On browser transitions
      // Trigger the loading mechanism (with shell)
      this.relatedUsersDataStore.load(dataSource);
    }

    return this.relatedUsersDataStore;
  }

  // * Firebase Create User Modal
  public createUser(user: FirebaseUserModel): Promise<void> {
    // Remove isShell property so it doesn't get stored in Firebase
    const { isShell, ...userDataToSave } = user;
    const userDocumentRef = doc(collection(this.firestore, 'users'));

    return setDoc(userDocumentRef, {...userDataToSave});
  }

  // * Firebase Update User Modal
  public updateUser(user: FirebaseUserModel): Promise<void> {
    // Remove isShell property so it doesn't get stored in Firebase
    const { isShell, ...userDataToSave } = user;
    const userDocumentRef = doc(this.firestore, 'users', user.id);

    return updateDoc(userDocumentRef, {...userDataToSave});
  }

  public deleteUser(userId: string): Promise<void> {
    const userDocumentRef = doc(this.firestore, 'users', userId);

    return deleteDoc(userDocumentRef);
  }

  // * Firebase Select User Image Modal
  public getAvatarsDataSource(): Observable<Array<UserImageModel>> {
    const avatarsDataSource: Observable<Array<UserImageModel>> = collectionData<UserImageModel>(
      query<UserImageModel>(
        collection(this.firestore, 'avatars') as CollectionReference<UserImageModel>
      )
    );

    return avatarsDataSource;
  }

  public getAvatarsStore(dataSource: Observable<Array<UserImageModel>>): DataStore<Array<UserImageModel>> {
    // Use cache if available
    if (!this.avatarsDataStore) {
      // Initialize the model specifying that it is a shell model
      const shellModel: Array<UserImageModel> = [
        new UserImageModel(),
        new UserImageModel(),
        new UserImageModel(),
        new UserImageModel(),
        new UserImageModel()
      ];

      this.avatarsDataStore = new DataStore(shellModel);
      // Trigger the loading mechanism (with shell) in the dataStore
      this.avatarsDataStore.load(dataSource);
    }

    return this.avatarsDataStore;
  }


  // ! FireStore utility methods


  // * Get list of all available Skills (used in the create and update modals)
  public getSkills(): Observable<Array<FirebaseSkillModel>> {
    const skillsDataSource: Observable<Array<FirebaseSkillModel>> = collectionData<FirebaseSkillModel>(
      query<FirebaseSkillModel>(
        collection(this.firestore, 'skills') as CollectionReference<FirebaseSkillModel>
      ),
      { idField: 'id' }
    );

    return skillsDataSource;
  }

  // * Get data of a specific Skill
  private getSkill(skillId: string): Observable<FirebaseSkillModel> {
    const skillDataSource: Observable<FirebaseSkillModel> = docData<FirebaseSkillModel>(
      doc(this.firestore, 'skills', skillId) as DocumentReference<FirebaseSkillModel>,
      { idField: 'id' }
    );

    return skillDataSource;
  }

  // * Get data of a specific User
  private getUser(userId: string): Observable<FirebaseUserModel> {
    const userDocumentRef = doc(this.firestore, 'users', userId) as DocumentReference<FirebaseUserModel>;
    const userDocumentSnapshotPromise = getDoc(userDocumentRef);

    const userDataSource: Observable<FirebaseUserModel> = from(userDocumentSnapshotPromise)
    .pipe(
      map((userSnapshot: DocumentSnapshot<FirebaseUserModel>) => {
        if (userSnapshot.exists()) {
          const user: FirebaseUserModel = userSnapshot.data();
          const age = this.calcUserAge(user.birthdate);
          const id = userSnapshot.id;

          return { id, age, ...user } as FirebaseUserModel;
        }
      })
    );

    // ? If you want to listen to document changes use docData() instead
    // const userDataSource: Observable<FirebaseUserModel> = docData<FirebaseUserModel>(
    //   doc(this.firestore, 'users', userId) as DocumentReference<FirebaseUserModel>,
    //   { idField: 'id' }
    // )
    // .pipe(
    //   map((user: FirebaseUserModel) => {
    //     const age = this.calcUserAge(user.birthdate);
    //     return { age, ...user } as FirebaseUserModel;
    //   })
    // );

    return userDataSource;
  }

  // * Get all users who share at least 1 skill of the user's 'skills' list
  private getUsersWithSameSkills(userId: string, skills: Array<FirebaseSkillModel>): Observable<Array<FirebaseListingItemModel>> {
    // Get the users who have at least 1 skill in common
    // Because firestore doesn't have a logical 'OR' operator we need to create multiple queries, one for each skill from the 'skills' list
    const rawAggregatedUsersWithSameSkillsDataSource: Array<Observable<Array<FirebaseListingItemModel>>> = skills.map(skill => {
      const usersWithSameSkillDataSource: Observable<Array<FirebaseListingItemModel>> = collectionData<FirebaseListingItemModel>(
        query<FirebaseListingItemModel>(
          collection(this.firestore, 'users') as CollectionReference<FirebaseListingItemModel>,
          where('skills', 'array-contains', skill.id)
        ),
        { idField: 'id' }
      )
      .pipe(
        map((users: Array<FirebaseListingItemModel>) => {
          return users.map((user: FirebaseListingItemModel) => {
            const age = this.calcUserAge(user.birthdate);
  
            return { age, ...user } as FirebaseListingItemModel;
          });
        })
      );

      return usersWithSameSkillDataSource;
    });

    // Combine all these queries
    const usersWithSameSkillsDataSource: Observable<Array<FirebaseListingItemModel>> = combineLatest(rawAggregatedUsersWithSameSkillsDataSource)
    .pipe(
      map((relatedUsers: FirebaseListingItemModel[][]) => {
        // Flatten the array of arrays of FirebaseListingItemModel
        const flattenedRelatedUsers = ([] as FirebaseListingItemModel[]).concat(...relatedUsers);

        // Removes duplicates from the array of FirebaseListingItemModel objects.
        // Also remove the original user (userId)
        const filteredRelatedUsers = flattenedRelatedUsers
        .reduce((accumulatedUsers, user) => {
          if ((accumulatedUsers.findIndex(accumulatedUser => accumulatedUser.id === user.id) < 0) && (user.id !== userId)) {
            return [...accumulatedUsers, user];
          } else {
            // If the user doesn't pass the test, then don't add it to the filtered users array
            return accumulatedUsers;
          }
        }, ([] as FirebaseListingItemModel[]));

        return filteredRelatedUsers;
      })
    );

    return usersWithSameSkillsDataSource;
  }

  private calcUserAge(dateOfBirth: number): number {
    return dayjs(Date.now()).diff(dayjs.unix(dateOfBirth), 'year');
  }
}
