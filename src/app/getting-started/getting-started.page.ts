import { Component, HostBinding, NgZone } from '@angular/core';
import { FormGroup, FormControl } from '@angular/forms';

import { MenuController } from '@ionic/angular';
import { IonicSwiper } from "@ionic/angular";

import SwiperCore, { Pagination } from "swiper";

SwiperCore.use([Pagination, IonicSwiper]);

@Component({
  selector: 'app-getting-started',
  templateUrl: './getting-started.page.html',
  styleUrls: [
    './styles/getting-started.page.scss',
    './styles/getting-started.shell.scss',
    './styles/getting-started.responsive.scss'
  ]
})
export class GettingStartedPage {
  @HostBinding('class.last-slide-active') isLastSlide = false;

  swiperRef: SwiperCore;
  gettingStartedForm: FormGroup;

  constructor(
    public menu: MenuController,
    private ngZone: NgZone
  ) {
    this.gettingStartedForm = new FormGroup({
      browsingCategory: new FormControl('men'),
      followingInterests: new FormGroup({
        tops: new FormControl(true),
        dresses: new FormControl(),
        jeans: new FormControl(),
        jackets: new FormControl(true),
        shoes: new FormControl(),
        glasses: new FormControl()
      })
    });
  }

  // Disable side menu for this page
  public ionViewDidEnter(): void {
    this.menu.enable(false);
  }

  // Restore to default when leaving this page
  public ionViewDidLeave(): void {
    this.menu.enable(true);
  }

  public swiperInit(swiper: SwiperCore): void {
    this.swiperRef = swiper;
  }

  public slideWillChange(): void {
    // ? We need to use ngZone because the change happens outside Angular
    // (see: https://swiperjs.com/angular#swiper-component-events)
    this.ngZone.run(() => {
      this.isLastSlide = this.swiperRef.isEnd;
    });
  }
}
