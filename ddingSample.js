/* eslint-disable indent */
// 추후 ShopDetailScene 코드 정리 예정 (2019.11.27 김호연)
import React, { Component } from 'react';
import {
    View,
    StyleSheet,
    Text,
    TouchableOpacity,
    Platform,
} from 'react-native';
import moment from 'moment';
import _ from 'lodash';
import {
    NavigationEvents,
    SafeAreaView,
} from 'react-navigation';
import Toast from 'react-native-simple-toast';

import StatusBar from '../../../components/header/StatusBar';
import ProgressBar from '../../../components/progress/ProgressBar';
import { injectStore } from '../../../components/hoc/context/MobxInjector';
import NavHeaderScrollView from '../../../components/view/NavHeaderScrollView';
import HorizontalTabBar from '../../../components/tabbar/HorizontalTabBar';
import ModalBase from '../../../components/modal/ModalBase';
import CartShortcutButton from '../../../components/button/CartShortcutButton';
import InfiniteViewPager from '../../../components/pager/ViewPager/InfiniteViewPager';
import ShopTabInfoView from './ShopTabInfoView';
import ShopTabGoodsView from './ShopTabGoodsView';
import ShopInfoBodyView from './ShopInfoBodyView';
import ShopTabReviewView from './ShopTabReviewView';
import MinPriceModal from './MinPriceModal';
import DiscountInfoModal from './DiscountInfoModal';
import DeliveryCostDetailModal from './DeliveryCostDetailModal';
import AlertButtonDialog from '../../../components/dialog/AlertButtonDialog';
import { createAbsoluteModal } from '../../../components/hoc/ModalContainer';
import DialogHelper from '../../../api/util/DialogHelper';

import StyleConfig from '../../../config/StyleConfig';
import NetworkConfig from '../../../config/NetworkConfig';
import LayoutConfig from '../../../config/LayoutConfig';
import Globals from '../../../config/Globals';

import {
    getWidthScaledValue as wsv,
    getShopStateText,
} from '../../../api/util';
import TimerHelper, { TYPE } from '../../../api/util/TimerHelper';
import FirebaseHelper, {
    EVENT_NAME_TABLE,
    REVIEW_EVENT_NAME_TABLE,
} from '../../../api/util/FirebaseHelper';
import { getCancelToken } from '../../../api/NetworkLayer';

import i18n from '../../../localization/i18n';
import textStyles from '../../../assets/styles/textStyles';

const ModalAlertButtonDialog = createAbsoluteModal(AlertButtonDialog);

const TAB_BAR_HEIGHT = wsv(47);
const TAB_BAR_BOTTOM_MARGIN = wsv(20);

class ShopDetailScene extends Component {
    constructor(props) {
        super(props);

        const { rootStore } = this.props;
        const userStore = rootStore.getStore('userStore');

        this.state = {
            secondsToClosed: 0,
            deliveryCostModalVisible: false,
            deliveryEvent: [],
            itemEvents: [],
            vendor: undefined,
            vendorMinPrice: 0,
            isFavoriteVendor: false,
            cartDeliveryCost: 0,
            itemGroupsWithoutDefault: [],
            today: this.getDayOfWeek(),
            useReminder: true,
            activatedTab: 0,
            reviewHeight: this.getReviewHeight(),
            reviewScrollEnabled: false,
            reviewPage: 0,
            reviewData: [],
            totalReviewCount: 0,
            reviewHeaderText: '',
            deleteReviewDialogProps: null,
            userId: userStore.getUser().getId() || '',
            isUserValid: userStore.getUser().isValid(),
            reviewProgressBar: true,
        };

        this.tabData = [
            {
                screen: ShopTabGoodsView,
                title: i18n.t('goods_tab_title'),
            },
            {
                screen: ShopTabInfoView,
                title: i18n.t('info_tab_title'),
            },
            {
                screen: ShopTabReviewView,
                title: i18n.t('review'),
            },
        ];
        this.reviewDataEnd = false;
        this.reviewSortType = Globals.REVIEW_SORT_TYPES.VENDOR_REVIEW_LIKE;
    }

    async componentDidMount() {
        const { navigation } = this.props;
        const vendorId = navigation.getParam('vendorId');

        if (!vendorId) {
            navigation.pop();
            return;
        }
        const result = await this.loadVendor(vendorId);

        if (result.error) {
            return;
        }
        if (this.infiniteViewPagerRef) this.infiniteViewPagerRef.onFocus();
        this.setCloseVendorTimer();
        this.setEventTimer();

        await this.getReviewData();
    }

    componentWillUnmount() {
        this.expireTimers();
        if (this.cancelToken) this.cancelToken.cancel();
        if (this.reviewCancelToken) this.reviewCancelToken.cancel();
        if (this.infiniteViewPagerRef) this.infiniteViewPagerRef.onBlur();
    }

    getReviewData = async () => {
        this.isGettingData = true;
        const { reviewData, reviewPage, vendor } = this.state;
        const { rootStore } = this.props;
        const branchStore = rootStore.getStore('branchStore');
        const idKey = '_id';

        this.reviewCancelToken = getCancelToken();
        const getReviewData = await branchStore.getVendorReviews({
            vendorId: vendor[idKey],
            page: reviewPage,
            sortType: this.reviewSortType,
            networkParameters: {
                cancelToken: this.reviewCancelToken.token,
            },
        });
        this.reviewCancelToken = undefined;
        if (getReviewData.error) {
            // 리뷰 데이터 에러시 어떻게 처리할까나?
            return;
        }

        if (getReviewData.reviewData.length > 0) {
            // 리뷰 list page nation 최대 갯수 20
            // 첫 request가 몇개 안될때 progress 사라지지 않는 문제 수정
            let extraState = {};
            if (getReviewData.reviewData.length < 20) {
                this.reviewDataEnd = true;
                extraState = { reviewProgressBar: false };
            }
            this.setState({
                reviewData: reviewData.concat(getReviewData.reviewData),
                reviewPage: reviewPage + 1,
                ...extraState,
            }, () => { this.isGettingData = false; });
        } else {
            this.isGettingData = false;
            this.reviewDataEnd = true;
            this.setState({ reviewProgressBar: false });
        }
    }

    onChangeReviewStandard = (sortType) => {
        this.setState({
            reviewPage: 0,
            reviewData: [],
            reviewProgressBar: true,
        }, () => {
            this.reviewSortType = sortType;
            this.reviewDataEnd = false;
            this.getReviewData();
        });
    }

    getReviewHeight = () => {
        const { rootStore } = this.props;
        const cartStore = rootStore.getStore('cartStore');
        const getCartItemCount = cartStore.getCartItemCount();
        const cartButtonHeight = getCartItemCount !== 0
            ? LayoutConfig.CART_SHORTCUT_BUTTON_HEIGHT
            : 0;

        return LayoutConfig.DRAWABLE_HEIGHT
            - LayoutConfig.NAVBAR_HEIGHT
            - LayoutConfig.SafeAreaInsets.bottom
            - cartButtonHeight
            - TAB_BAR_BOTTOM_MARGIN
            - TAB_BAR_HEIGHT;
    }

    loadVendor = async (vendorId) => {
        const { rootStore, navigation } = this.props;
        const branchStore = rootStore.getStore('branchStore');

        this.cancelToken = getCancelToken();
        const result = await branchStore.getVendor({
            vendorId,
            networkParameters: {
                cancelToken: this.cancelToken.token,
            },
        });
        this.cancelToken = undefined;

        if (result.error) {
            if (result.code !== NetworkConfig.ERROR_CODE_CANCEL) {
                navigation.pop();
            }
            return { error: true };
        }
        const vendor = this.getTransformedVendor(result);
        const state = { vendor };
        const itemGroupsWithoutDefault = [];

        vendor.itemGroups.forEach((itemGroup) => {
            if (itemGroup.name !== 'defaultGroup' && itemGroup.items) {
                if (itemGroup.items.length > 0) {
                    itemGroupsWithoutDefault.push(itemGroup);
                }
            }
        });
        state.itemGroupsWithoutDefault = itemGroupsWithoutDefault;

        let vendorMinPrice = vendor.settleInfo.minPrice;
        const eventsData = vendor.eventInfo.events || [];
        const itemEvents = _.filter(eventsData, { eventType: 'ITEM' });
        const deliveryEvent = _.filter(eventsData, { eventType: 'DELIVERY' });

        if (deliveryEvent.length > 0) {
            vendorMinPrice = deliveryEvent[0].eventDetail.eventMinPrice;
        }
        if (vendor.isFavorited !== null && vendor.isFavorited !== undefined) {
            state.isFavoriteVendor = vendor.isFavorited;
        }

        state.vendorMinPrice = vendorMinPrice;
        state.deliveryEvent = deliveryEvent;
        state.itemEvents = itemEvents;
        state.totalReviewCount = vendor.stats.reviewCountForApp;
        state.reviewHeaderText = vendor.stats.satisfactionText;
        state.bestItemList = vendor.bestItemList;
        this.setState(state);
        return {};
    }

    setCloseVendorTimer = () => {
        const { vendor } = this.state;
        const getSecondsToClose = this.getSecondsToClose(vendor);

        if ((getSecondsToClose && getSecondsToClose <= 1800)
            && vendor.operatingTimeStatus.type === Globals.VendorStatus.OPEN) {
            this.vendorClosingTimer = this.timerRefer.addTimer({
                callback: () => {
                    const leftSeconds = this.getSecondsToClose(vendor);
                    if (!leftSeconds) {
                        const { navigation } = this.props;
                        const vendorId = navigation.getParam('vendorId');
                        navigation.replace('ShopDetailScene', { vendorId });
                        return;
                    }
                    this.setState({ secondsToClosed: leftSeconds });
                },
                millisecond: 1000,
                type: TYPE.setInterval,
            });
        }
    }

    getTransformedVendor = (vendor) => {
        // details 이미지 없을때 cover 이미지를 사용하기로 인화님과 협의함(05.15)
        const detailsImage = _.get(vendor, 'appExposureInfo.images.details', []);
        const coverImage = _.get(vendor, 'appExposureInfo.images.cover', undefined);

        if (_.isEmpty(detailsImage) && !_.isEmpty(coverImage)) {
            detailsImage[0] = coverImage;
        }
        const transformedVendor = { ...vendor };

        // 베스트 뱃시 설정을 위한 data transform
        const { bestItemList } = transformedVendor;
        let hasBestList = false;
        if (!_.isEmpty(bestItemList)) {
            hasBestList = true;
            transformedVendor.bestItemList = bestItemList.map((item) => {
                const convertItem = item;
                convertItem.isBestGoodsItem = true;
                return item;
            });
        }

        transformedVendor.itemGroups = vendor.itemGroups.map((itemGroup) => {
            const newItemGroup = { ...itemGroup };
            newItemGroup.items = newItemGroup.items || [];

            if (_.isEmpty(newItemGroup.name)) {
                newItemGroup.name = i18n.t('menu');
            }

            // 베스트 뱃시 설정을 위한 data transform
            if (hasBestList && !_.isEmpty(newItemGroup.items)) {
                newItemGroup.items = newItemGroup.items.map((item) => {
                    const convertItem = item;
                    const idKey = '_id';
                    const findIndex = _.findIndex(bestItemList, ['_id', convertItem[idKey]]);
                    if (findIndex >= 0) {
                        convertItem.isBestGoodsItem = true;
                    }
                    return convertItem;
                });
            }
            return newItemGroup;
        });
        transformedVendor.title = transformedVendor.name;
        const validImagesUrl = [];
        if (detailsImage) {
            _.forEach(detailsImage, (url) => {
                if (url && (url.length > 0)) {
                    validImagesUrl.push(url);
                }
            });
        }
        _.set(transformedVendor, 'appExposureInfo.images.details', validImagesUrl);
        console.log({ transformedVendor });
        return transformedVendor;
    }

    getDayOfWeek = () => {
        const dayNumber = moment().day();
        let today;
        if (dayNumber === 0) {
            today = 'sunday';
        } else if (dayNumber === 1) {
            today = 'monday';
        } else if (dayNumber === 2) {
            today = 'tuesday';
        } else if (dayNumber === 3) {
            today = 'wednesday';
        } else if (dayNumber === 4) {
            today = 'thursday';
        } else if (dayNumber === 5) {
            today = 'friday';
        } else if (dayNumber === 6) {
            today = 'saturday';
        }
        return today;
    }

    getSecondsToClose = (vendor) => {
        const { today } = this.state;
        const { operationTimeInfo } = vendor;
        const currentTime = moment().format('H:mm:ss').split(':');

        if (!operationTimeInfo
            || !operationTimeInfo.businessHour[today]
            || !operationTimeInfo.businessHour[today].breaktimes) {
            return null;
        }
        if (operationTimeInfo.businessHour[today].breaktimes[0].from) {
            const breakTimeStart = operationTimeInfo.businessHour[today].breaktimes[0].from;
            const breakTimeSplit = breakTimeStart.split(':');
            const breakTimeDiff = ((breakTimeSplit[0] * 60) + (breakTimeSplit[1] * 1)) * 60
                - (((currentTime[0] * 60) + (currentTime[1] * 1)) * 60 + (currentTime[2] * 1));
            if (breakTimeDiff > 0 && breakTimeDiff <= 1800) {
                return breakTimeDiff;
            }
        }
        if (operationTimeInfo.businessHour[today].to) {
            const closingTime = operationTimeInfo.businessHour[today].to.split(':');
            const closingTimeDiff = ((closingTime[0] * 60) + ((closingTime[1] * 1) + 1)) * 60
                - (((currentTime[0] * 60) + (currentTime[1] * 1)) * 60 + (currentTime[2] * 1));
            if (closingTimeDiff > 0 && closingTimeDiff <= 1800) {
                return closingTimeDiff;
            }
        }
        return null;
    }

    onWillBlur = () => {
        if (this.infiniteViewPagerRef) this.infiniteViewPagerRef.onBlur();
    }

    onDidFocus = () => {
        if (this.infiniteViewPagerRef) this.infiniteViewPagerRef.onFocus();
    }

    checkItemEventsEnd = () => {
        const { itemEvents } = this.state;
        const { navigation } = this.props;

        itemEvents.forEach((itemEvent) => {
            const timeLeft = moment(itemEvent.to).diff(moment()) / Globals.AN_HOUR_IN_MILLISECONDS;
            if (timeLeft === 0 || timeLeft < 0) {
                navigation.replace('ShopDetailScene', { vendorId: itemEvent.vendorId });
            }
        });
    }

    setEventTimer = () => {
        const { itemEvents } = this.state;

        if (itemEvents.length > 0) {
            this.itemEventsTimer = this.timerRefer.addTimer({
                callback: this.checkItemEventsEnd,
                millisecond: 1000,
                type: TYPE.setInterval,
            });
        }
    }

    expireTimers = () => {
        if (this.vendorClosingTimer) this.timerRefer.clearTimer(this.vendorClosingTimer);
        if (this.itemEventsTimer) this.timerRefer.clearTimer(this.itemEventsTimer);
    }

    renderForegroundHeader = () => {
        const { vendor } = this.state;
        const imagesUrl = _.get(vendor, 'appExposureInfo.images.details', []);
        return (
            <View style={styles.naviHeader}>
                <InfiniteViewPager
                    ref={(refs) => { this.infiniteViewPagerRef = refs; }}
                    width={styles.naviHeader.width}
                    height={styles.naviHeader.height}
                    imageList={imagesUrl}
                    onPress={this.onClickHeaderImage}
                    autoPlayInterval={Globals.VENDOR_IMAGE_PAGER_INTERVAL_TIMES}
                    enableAutoPlay
                />
                {
                    vendor.operatingTimeStatus.type !== Globals.VendorStatus.OPEN
                    && this.renderHeaderOverlay()
                }
            </View>
        );
    }

    renderHeaderOverlay = () => {
        const { vendor } = this.state;
        const shopStateText = getShopStateText(vendor.operatingTimeStatus.type);
        return (
            <TouchableOpacity
                style={styles.foregroundHeader}
                onPress={this.onClickHeaderImage}
                activeOpacity={1}
            >
                <View style={styles.foregroundOverlay}>
                    <Text style={styles.foregroundOverlayText}>
                        {shopStateText}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    }

    processAnalytic = () => {
        FirebaseHelper.analyticsLogEvent({
            checkEvents: {
                [EVENT_NAME_TABLE.RDShopDetail]: EVENT_NAME_TABLE.RDGoodsDetail,
                [EVENT_NAME_TABLE.OHShopDetail]: EVENT_NAME_TABLE.OHGoodsDetail,
                [EVENT_NAME_TABLE.RSShopDetail]: EVENT_NAME_TABLE.RSGoodsDetail,
                [EVENT_NAME_TABLE.PShopDetail]: EVENT_NAME_TABLE.PGoodsDetail,
                [EVENT_NAME_TABLE.NSShopDetail]: EVENT_NAME_TABLE.NSGoodsDetail,
                [EVENT_NAME_TABLE.RDSShopDetail]: EVENT_NAME_TABLE.RDSGoodsDetail,
                [EVENT_NAME_TABLE.RSSSShopDetail]: EVENT_NAME_TABLE.RSSSGoodsDetail,
                [EVENT_NAME_TABLE.RDBYShopDetail]: EVENT_NAME_TABLE.RDBYGoodDetail,
                [EVENT_NAME_TABLE.RDHSShopDetail]: EVENT_NAME_TABLE.RDHSGoodsDetail,
                [EVENT_NAME_TABLE.RDBYHSShopDetail]: EVENT_NAME_TABLE.RDBYHSGoodsDetail,
                [EVENT_NAME_TABLE.RDSShopDetail1]: EVENT_NAME_TABLE.RDSGoodsDetail1,
                [EVENT_NAME_TABLE.RDBYSShopDetail]: EVENT_NAME_TABLE.RDBYSGoodsDetail,
                [EVENT_NAME_TABLE.RDPShopDetail]: EVENT_NAME_TABLE.RDPGoodsDetail,
                [EVENT_NAME_TABLE.MPShopDetail]: EVENT_NAME_TABLE.MPGoosDetail,
            },
        });
    }

    onPressGoods = (item) => {
        const { vendor } = this.state;
        const { navigation } = this.props;
        const idKey = '_id';
        navigation.navigate('GoodsDetailScene', {
            vendorId: vendor[idKey],
            itemId: item[idKey],
        });
        this.processAnalytic();
    }

    flashScrollBar = () => {
        if (this.deliveryCostDetail) this.deliveryCostDetail.flashScrollIndicators();
    }

    renderDeliveryCostModal = () => {
        const { vendor } = this.state;
        const { status, estimatedDeliveryFee } = vendor;
        return (
            <DeliveryCostDetailModal
                ref={(refs) => { this.deliveryCostDetail = refs; }}
                status={status}
                estimatedDeliveryFee={estimatedDeliveryFee}
                onPressModalCancel={this.onPressModalCancel}
            />
        );
    }

    toggleMinPriceModal = () => {
        if (this.minPriceModal) this.minPriceModal.toggle();
    }

    renderMinPriceModal = () => {
        const { navigation } = this.props;
        const { vendor, vendorMinPrice } = this.state;
        return (
            <MinPriceModal
                ref={(refs) => { this.minPriceModal = refs; }}
                vendor={vendor}
                navigation={navigation}
                minPrice={vendorMinPrice}
            />
        );
    }

    toggleDeliveryDiscountModal = () => {
        if (this.discountModal) this.discountModal.toggle();
    }

    checkCartDeliveryCost = (deliveryCost) => {
        this.setState({ cartDeliveryCost: deliveryCost });
    }

    renderDeliveryDiscountModal = () => {
        const { navigation } = this.props;
        const {
            deliveryEvent,
            cartDeliveryCost,
            vendor,
            vendorMinPrice,
        } = this.state;
        return (
            <DiscountInfoModal
                ref={(refs) => { this.discountModal = refs; }}
                navigation={navigation}
                deliveryEvent={deliveryEvent}
                cartDeliveryCost={cartDeliveryCost}
                vendor={vendor}
                minPrice={vendorMinPrice}
            />
        );
    }

    onClickHeaderImage = () => {
        const { vendor } = this.state;
        const { navigation } = this.props;
        const imagesUrl = _.get(vendor, 'appExposureInfo.images.details', []);
        const vendorTitle = vendor.title || '';
        navigation.navigate({
            routeName: 'ImageViewerScene',
            params: {
                title: vendorTitle,
                images: imagesUrl,
            },
        });
    }

    onPressReviewImage = (imageUrl) => {
        const { vendor } = this.state;
        const { navigation } = this.props;
        const vendorTitle = vendor.title || '';

        if (imageUrl) {
            // 추후 복수 이미지가 될 경우, 아래 배열에 추가 (19/11/19 김호연)
            const imageUrls = [imageUrl];

            navigation.navigate({
                routeName: 'ImageViewerScene',
                params: {
                    title: vendorTitle,
                    images: imageUrls,
                },
            });
        }
    }

    onClickDeliveryCostDetail = () => {
        this.setState({ deliveryCostModalVisible: true });
    }

    onPressModalCancel = () => {
        this.setState({ deliveryCostModalVisible: false });
    }

    renderShopInfoBody = () => {
        const { vendor, vendorMinPrice } = this.state;
        return (
            <ShopInfoBodyView
                vendor={vendor}
                onPressDelivery={this.onClickDeliveryCostDetail}
                minPrice={vendorMinPrice}
            />
        );
    }

    onTabPress = (activeTabIndex) => {
        const { activatedTab, useReminder } = this.state;

        if (activatedTab === activeTabIndex) {
            return;
        }
        if (activeTabIndex === 2) {
            this.outsideScrollToEnd();
            FirebaseHelper.analyticsLogEventForReview({
                eventName: REVIEW_EVENT_NAME_TABLE.Review,
            });
            this.setState({ useReminder: false });
        } else if (activeTabIndex !== 2) {
            if (!useReminder) {
                this.setState({ useReminder: true });
            }
        }
        this.setState({ activatedTab: activeTabIndex });
    }

    onReviewReachedEnd = () => {
        if (!this.isGettingData && !this.reviewDataEnd) {
            this.getReviewData();
        }
    }

    checkDeliveryDiscount = () => {
        const { deliveryEvent, vendor } = this.state;

        if ((deliveryEvent.length === 0 && vendor.estimatedDeliveryFee.discountTable.length === 0)
            || !vendor.status.isAffiliation) {
            return false;
        }
        return true;
    }

    renderProgressBar = () => (
        <View style={styles.rootView}>
            <ProgressBar
                style={styles.progress}
                visible
            />
        </View>
    )

    onReachedScrollEnd = ({ layoutMeasurement, contentOffset, contentSize }) => {
        const layoutHeight = _.ceil(layoutMeasurement.height);
        const offsetY = _.ceil(contentOffset.y);
        const contentHeight = _.floor(contentSize.height);
        return layoutHeight + offsetY >= contentHeight - 20;
    }

    onScrollOutside = ({ nativeEvent }) => {
        const { reviewScrollEnabled, activatedTab } = this.state;
        if (activatedTab === 2) {
            if (!reviewScrollEnabled) {
                if (this.onReachedScrollEnd(nativeEvent)) {
                    this.setState({ reviewScrollEnabled: true });
                }
            }
            if (reviewScrollEnabled) {
                if (!this.onReachedScrollEnd(nativeEvent)) {
                    this.setState({ reviewScrollEnabled: false });
                }
            }
        }
    }

    renderTabContent = () => {
        const {
            activatedTab,
            itemGroupsWithoutDefault,
            vendor,
            itemEvents,
            reviewData,
            reviewHeight,
            totalReviewCount,
            reviewScrollEnabled,
            reviewHeaderText,
            userId,
            reviewProgressBar,
            bestItemList,
        } = this.state;
        return this.tabData.map((tabItem, index) => {
            const { screen: PassedComponent } = tabItem;
            const mapKey = index;
            const style = (activatedTab === index)
                ? { display: 'flex' }
                : { display: 'none' };

            const props = {
                key: mapKey,
                style,
            };

            switch (index) {
                case 0: {
                    props.itemGroups = itemGroupsWithoutDefault;
                    props.status = vendor.operatingTimeStatus.type;
                    props.onPressGoods = this.onPressGoods;
                    props.itemEvents = itemEvents;
                    props.bestItemList = bestItemList;
                    break;
                }
                case 1: {
                    props.vendor = vendor;
                    break;
                }
                case 2: {
                    props.reviewData = reviewData;
                    props.totalReviewCount = totalReviewCount;
                    props.reviewHeight = reviewHeight;
                    props.onReviewReachedEnd = this.onReviewReachedEnd;
                    props.onChangeReviewStandard = this.onChangeReviewStandard;
                    props.reviewScrollEnabled = reviewScrollEnabled;
                    props.nPressDeleteReview = this.onPressDeleteReview;
                    props.userId = userId;
                    props.onPressReviewImage = this.onPressReviewImage;
                    props.reviewProgressBar = reviewProgressBar;
                    props.reviewHeaderText = reviewHeaderText;
                    props.onPressReviewLike = this.onPressReviewLike;
                    break;
                }
                default:
                    break;
            }

            return (
                <PassedComponent
                    {...props}
                />
            );
        });
    }

    onPressReviewLike = (params) => {
        const { rootStore } = this.props;
        const branchStore = rootStore.getStore('branchStore');
        const { reviewId } = params;

        branchStore.updateReviewLikeCount({ reviewId });
    }

    onPressDeleteReview = (reviewId) => {
        const deleteReviewDialogProps = {
            description: i18n.t('ask_delete_review'),
            ...DialogHelper.getOkCancelButtonProps({
                rightTitle: i18n.t('ok'),
                leftTitle: i18n.t('cancel'),
                rightOnPress: () => {
                    this.setState({ deleteReviewDialogProps: null }, () => {
                        this.deleteReview(reviewId);
                    });
                },
                leftOnPress: () => {
                    this.setState({ deleteReviewDialogProps: null });
                },
            }),
        };
        this.setState({ deleteReviewDialogProps });
    }

    deleteReview = async (reviewId) => {
        const { rootStore } = this.props;
        const { reviewData } = this.state;
        const branchStore = rootStore.getStore('branchStore');
        const result = await branchStore.deleteVendorReviews({ reviewId });

        if (result.error) {
            Toast.show(i18n.t('response_error_500'), Toast.SHORT);
            return;
        }
        const newReviewData = reviewData;
        const targetReviewIndex = _.findIndex(reviewData, { _id: reviewId });

        if (targetReviewIndex !== -1) {
            newReviewData.splice(targetReviewIndex, 1);
            this.setState({ reviewData: newReviewData });
        }
    }

    renderDeleteReviewDialog = () => {
        const { deleteReviewDialogProps } = this.state;
        const isVisible = !!deleteReviewDialogProps;
        return (
            <ModalAlertButtonDialog
                isVisible={isVisible}
                {...deleteReviewDialogProps}
            />
        );
    }

    outsideScrollToEnd = () => {
        if (this.scrollViewRef) {
            this.scrollViewRef.scrollToEnd();
        }
    }

    onPressFavoriteIcon = async () => {
        const { rootStore } = this.props;
        const userStore = rootStore.getStore('userStore');
        const { vendor, isFavoriteVendor } = this.state;
        const idKey = '_id';
        const reversedFavorite = !isFavoriteVendor;

        if (this.favCancelToken) {
            this.favCancelToken.cancel();
        }
        this.favCancelToken = getCancelToken();
        const result = await userStore.setFavorite({
            vendorId: vendor[idKey],
            isFavorited: reversedFavorite,
            networkParameters: {
                cancelToken: this.favCancelToken.token,
            },
        });

        if (result.error) {
            return;
        }
        this.setState({ isFavoriteVendor: reversedFavorite });
    }

    render() {
        const { navigation } = this.props;
        const {
            vendor,
            secondsToClosed,
            vendorMinPrice,
            deliveryCostModalVisible,
            useReminder,
            isFavoriteVendor,
            isUserValid,
        } = this.state;

        if (!vendor) return this.renderProgressBar();

        const details = _.get(vendor, 'appExposureInfo.images.details', undefined);
        let vendorName = vendor.title;

        if (vendor.vendorBranchName !== null && vendor.vendorBranchName !== undefined) {
            vendorName = `${vendor.name} ${vendor.vendorBranchName}`;
        }
        const headerData = {
            url: details,
            title: vendorName,
        };
        const idKey = '_id';
        const doingDeliveryDiscount = this.checkDeliveryDiscount();
        const isIosDevice = Platform.OS === 'ios';

        return (
            <View style={styles.rootView}>
                {isIosDevice && (<StatusBar />)}
                <ModalBase
                    isVisible={deliveryCostModalVisible}
                    style={styles.deliveryCostModal}
                    onShow={this.flashScrollBar}
                >
                    {this.renderDeliveryCostModal()}
                </ModalBase>
                <NavHeaderScrollView
                    scrollRef={(ref) => { this.scrollViewRef = ref; }}
                    data={headerData}
                    titleParam={{
                        titleStyle: { marginHorizontal: wsv(40) },
                        titleProps: { numberOfLines: 1, ellipsizeMode: 'tail' },
                    }}
                    navigator={navigation}
                    imageHeight={wsv(200)}
                    headerBackgroundColor="transparent"
                    renderForegroundHeader={this.renderForegroundHeader}
                    secondsToClosed={secondsToClosed}
                    outputScaleValue={6}
                    useBackButtonGradient
                    notUseStatusBar={isIosDevice}
                    useFavoriteIcon={isUserValid}
                    isFavoriteVendor={isFavoriteVendor}
                    onPressFavoriteIcon={this.onPressFavoriteIcon}
                    showsVerticalScrollIndicator={false}
                    onScroll={this.onScrollOutside}
                    bounces={false}
                >
                    <View style={styles.contentView}>
                        {this.renderShopInfoBody()}
                    </View>
                    <HorizontalTabBar
                        style={styles.tabBar}
                        tabs={this.tabData.map(item => item.title)}
                        onTabPress={this.onTabPress}
                    />
                    {this.renderTabContent()}
                    {
                        useReminder && (
                            <Text style={styles.reminderView}>
                                {i18n.t('shop_detail_reminder')}
                            </Text>
                        )
                    }
                </NavHeaderScrollView>
                <CartShortcutButton
                    navigation={navigation}
                    minPrice={vendorMinPrice}
                    toggleMinPriceModal={this.toggleMinPriceModal}
                    toggleDeliveryDiscountModal={this.toggleDeliveryDiscountModal}
                    vendorId={vendor[idKey]}
                    canIgnoreMinPrice={vendor.settleInfo.canIgnoreMinPrice}
                    checkCartDeliveryCost={this.checkCartDeliveryCost}
                    doingDeliveryDiscount={doingDeliveryDiscount}
                />
                <SafeAreaView
                    style={styles.safeArea}
                    forceInset={{ bottom: 'always' }}
                />
                {this.renderMinPriceModal()}
                {this.renderDeliveryDiscountModal()}
                {this.renderDeleteReviewDialog()}
                <NavigationEvents
                    onWillBlur={this.onWillBlur}
                    onDidFocus={this.onDidFocus}
                />
                <TimerHelper ref={(refs) => { this.timerRefer = refs; }} />
            </View>
        );
    }
}

export default injectStore({ component: ShopDetailScene });

const styles = StyleSheet.create({
    rootView: {
        flex: 1,
        backgroundColor: StyleConfig.WHITE_FOUR,
    },
    foregroundHeader: {
        position: 'absolute',
        top: 0,
        width: LayoutConfig.SCREEN_WIDTH,
        height: wsv(200),
    },
    foregroundOverlay: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: StyleConfig.BLACK_THREE50,
    },
    foregroundOverlayText: {
        ...textStyles.boldText,
        fontSize: wsv(20),
        color: StyleConfig.WHITE_FOUR,
        textDecorationLine: 'underline',
    },
    navigator: {
        backgroundColor: 'transparent',
        borderBottomWidth: 0,
    },
    naviHeader: {
        width: LayoutConfig.SCREEN_WIDTH,
        height: wsv(200),
    },
    contentView: {
        marginTop: wsv(21),
        marginHorizontal: wsv(30),
        marginBottom: wsv(20),
    },
    tabBar: {
        width: LayoutConfig.SCREEN_WIDTH,
        height: wsv(47),
        paddingLeft: wsv(28),
        paddingRight: wsv(28),
        marginBottom: wsv(20),
    },
    reminderView: {
        marginTop: wsv(10),
        paddingVertical: wsv(24),
        paddingHorizontal: wsv(19),
        backgroundColor: StyleConfig.WHITE_TWO,
        color: StyleConfig.WARM_GREY,
        lineHeight: wsv(20),
        letterSpacing: wsv(-0.5),
        fontSize: wsv(10),
    },
    cart: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: LayoutConfig.SCREEN_WIDTH,
        height: wsv(55),
        paddingVertical: wsv(14),
        paddingHorizontal: wsv(30),
        backgroundColor: StyleConfig.MAIZE,
    },
    deliveryCostModal: {
        alignSelf: 'center',
        width: wsv(345),
        height: wsv(454),
    },
    progress: {
        backgroundColor: 'transparent',
    },
    safeArea: {
        backgroundColor: 'transparent',
    },
});