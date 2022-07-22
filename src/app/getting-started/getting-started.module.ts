import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Routes, RouterModule } from '@angular/router';

import { IonicModule } from '@ionic/angular';

import { SwiperModule } from "swiper/angular";

import { ComponentsModule } from '../components/components.module';

import { GettingStartedPage } from './getting-started.page';

const routes: Routes = [
  {
    path: '',
    component: GettingStartedPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    RouterModule.forChild(routes),
    ComponentsModule,
    SwiperModule
  ],
  declarations: [GettingStartedPage]
})
export class GettingStartedPageModule {}
