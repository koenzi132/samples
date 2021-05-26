/* eslint-disable indent */
import React, { Component } from 'react';
import {
    View,
    StyleSheet,
    Platform,
    Text,
} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { NavigationEvents } from 'react-navigation';
import Toast from 'react-native-simple-toast';
import { reaction } from 'mobx';
import _ from 'lodash';
import Popover, { Rect } from 'react-native-popover-view';

import NavigationSearchBar from '../../components/header/NavigationSearchBar';
import { injectStore } from '../../components/hoc/context/MobxInjector';
import CartShortcutButton from '../../components/button/CartShortcutButton';
import ShopListTabView from './ShopListTabView';

import { getCancelToken } from '../../api/NetworkLayer';
import NavBarHelper from '../../api/util/NavBarHelper';
import ListHelper from '../../api/util/ListHelper';
import FirebaseHelper, { EVENT_NAME_TABLE } from '../../api/util/FirebaseHelper';

import StyleConfig from '../../config/StyleConfig';
import i18n from '../../localization/i18n';
import Globals, { DEV_MODE } from '../../config/Globals';
import LayoutConfig from '../../config/LayoutConfig';
import {
    getWidthScaledValue as wsv,
} from '../../api/util';
import textStyles from '../../assets/styles/textStyles';

class ShopListScene extends Component {
    static generatePagesFromProps(props) {
        const { rootStore } = props;
        const branchStore = rootStore.getStore('branchStore');
        const branch = branchStore.getBranch();
        const foodCategories = branch.getFoodCategories();

        const userStore = rootStore.getStore('userStore');
        const user = userStore.getUser();

        if (foodCategories.length < 1) {
            return [];
        }

        const keySuffix = branch.getBranchId();
        const pages = [];

        for (let i = 0; i < foodCategories.length; i += 1) {
            const foodCategory = foodCategories[i];
            if (foodCategory.available
                && (user.isValid()
                    || (!foodCategory.isFavoriteCategory
                        && !foodCategory.isRecommendationCategory))) {
                pages.push({
                    key: `${keySuffix}TabPage${i}`,
                    tabLabel: {
                        key: `${keySuffix}Tab${foodCategory.name}`,
                        label: foodCategory.name, // Just use default name for now
                    },
                    pageData: [],
                    // foodCategory is used in the query of the search
                    foodCategory: foodCategory.name,
                    // '-1' means this page is not initialized
                    currentPageIndex: foodCategory.isFavoriteCategory && !user.isValid() ? 0 : -1,
                    isForBestCategory: foodCategory.isBestCategory,
                    isForFavorites: foodCategory.isFavoriteCategory,
                    isForEvents: foodCategory.isEventCategory,
                    isForRecommendCategory: foodCategory.isRecommendationCategory,
                    endReached: false,
                    refreshing: false,
                    foodCategoryForAnalytic: foodCategory.nameEn || 'category_no_name',
                });
            }
        }
        return pages;
    }

    static isNonSortablePage(page) {
        return page.isForBestCategory
            || page.isForFavorites
            || page.isForEvents
            || page.isForRecommendCategory;
    }

    static setNodeMaxValue(
        tabAnimProps,
        size,
        index,
    ) {
        const { animationProps } = tabAnimProps;
        if (!animationProps) {
            return;
        }
        const { maxValue } = animationProps.scrollValues[index];

        maxValue.setValue(size);
    }

    static ONEND_REACHED_THRESHOLD = 50;

    constructor(props) {
        super(props);
        const { rootStore } = props;
        const branchStore = rootStore.getStore('branchStore');
        const available = branchStore.checkIfAvailable({ assistCode: Globals.FOOD_ASSIST_CODE });
        const sceneStore = rootStore.getStore('sceneStore');
        const userStore = rootStore.getStore('userStore');
        const pages = available ? ShopListScene.generatePagesFromProps(props) : [];

        const userId = userStore.getUser().getId();

        this.state = {
            pages,
            activeTab: 0,
            sortType: sceneStore.getActiveShopListSortType(),
            searchText: undefined,
            tabAnimProps: this.createTabAnimProps(pages.length),
            navBarAnimDisabled: false,
            scrollEnabled: true,
            userId,
            popoverIsVisible: false,
        };

        this.tabViewProps = this.createTabViewProps();

        this.fetchTabDataFunctions = {};
        this.cancelTokenMap = {};
        this.pageMaxHeightMap = {};

        this.tabViewRef = React.createRef();
        this.popoverRect = new Rect(
            0,
            0,
            LayoutConfig.SCREEN_WIDTH,
            NavigationSearchBar.getHeight() + LayoutConfig.SEARCHBAR_HEIGHT,
        );
        this.POPOVER_TIME = Globals.A_SECOND_IN_MILLISECONDS * 7;
    }

    componentDidMount() {
        const { rootStore, navigation } = this.props;
        const { activeTab, pages } = this.state;

        const branchStore = rootStore.getStore('branchStore');
        if (!branchStore.checkIfAvailable({ assistCode: Globals.FOOD_ASSIST_CODE })
            || pages.length < 1) {
            navigation.pop();
            return;
        }

        this.loadMoreInTab(activeTab);
        this.favoriteIndex = this.findFavoritePageIndex(pages);

        this.userListener = reaction(
            () => {
                const userStore = rootStore.getStore('userStore');
                const user = userStore.getUser();

                return user;
            },
            (user) => {
                const { userId } = this.state;
                if (userId === user.getId()) {
                    return;
                }
                const newPages = ShopListScene.generatePagesFromProps(this.props);
                this.pageMaxHeightMap = {};
                this.initialPageIndex = 0;

                this.setState({
                    pages: newPages,
                    userId: user.getId(),
                    activeTab: 0,
                    tabAnimProps: this.createTabAnimProps(newPages.length),
                }, this.onPagesReset);
            },
        );
        if (this.getShowPopoverState()) {
            this.startPopoverTimer();
        }
    }

    componentDidUpdate() {
        const { pages } = this.state;
        this.favoriteIndex = this.findFavoritePageIndex(pages);
    }

    componentWillUnmount() {
        this.fetchTabDataFunctions = undefined;
        if (this.userListener) {
            this.userListener();
        }

        this.cancelPendingRequests();
        this.cancelTokenMap = undefined;
        this.closePopOver();
    }

    getShowPopoverState = () => {
        const { rootStore } = this.props;
        const { userId } = this.state;
        const isShowPopover = rootStore.getStore('sceneStore').getIsShowCategoryPopover();
        let showState = false;
        if (isShowPopover && !_.isEmpty(userId)) {
            showState = true;
        }
        return showState;
    }

    saveIsShowPopover = () => {
        if (this.getShowPopoverState()) {
            const { rootStore } = this.props;
            rootStore.getStore('sceneStore').setIsShowCategoryPopover(false);
        }
    }

    startPopoverTimer = () => {
        if (!this.popoverTimeout) {
            this.setState({ popoverIsVisible: true });
            this.popoverTimeout = setTimeout(
                this.changePopoverState,
                this.POPOVER_TIME,
            );
        }
    }

    changePopoverState = () => {
        this.saveIsShowPopover();
        this.closePopOver();
    }

    closePopOver = () => {
        const { popoverIsVisible } = this.state;
        if (popoverIsVisible) {
            this.setState({
                popoverIsVisible: false,
            });
        }

        if (this.popoverTimeout) {
            clearTimeout(this.popoverTimeout);
            this.popoverTimeout = undefined;
        }
    }

    renderPopover = () => {
        const { popoverIsVisible } = this.state;
        const baseOffset = Platform.OS === 'android'
            ? 0 : -LayoutConfig.SafeAreaInsets.top;
        return (
            <Popover
                isVisible={popoverIsVisible}
                fromRect={this.popoverRect}
                placement="bottom"
                showBackground={false}
                popoverStyle={styles.popoverStyle}
                onClose={this.changePopoverState}
                showInModal={false}
                verticalOffset={baseOffset}
            >
                <View style={styles.popoverTextContainer}>
                    <Text style={styles.distanceComment1}>
                        {i18n.t('custom_category')}
                    </Text>
                </View>
            </Popover>
        );
    }

    createTabAnimProps = (
        numberOfPages,
        initialValues,
        initialOffsetValue,
        initialMaxValues,
    ) => (
            numberOfPages > 0
                ? NavBarHelper.getMultiScrollAnimationProps({
                    numScrollViews: numberOfPages,
                    min: NavigationSearchBar.getCollapsedHeight(),
                    max: NavigationSearchBar.getHeight(),
                    initialValues,
                    initialOffsetValue,
                    initialMaxValues,
                })
                : {}
        );

    createTabViewProps = () => {
        const tabViewProps = {
            scrollEventThrottle: 16,
            initialNumToRender: 1,
            maxToRenderPerBatch: 7,
            updateCellsBatchingPeriod: 150,
        };

        const deviceMemory = DeviceInfo.getTotalMemory();

        const maxMemoryInMb = deviceMemory / 1024 / 1024;

        const memThreshold1 = Platform.OS === 'ios' ? 1000 : 3000;
        const memThreshold2 = Platform.OS === 'ios' ? 700 : 2000;

        if (maxMemoryInMb >= memThreshold1) {
            tabViewProps.windowSize = 7;
        } else if (maxMemoryInMb >= memThreshold2) {
            tabViewProps.windowSize = Platform.OS === 'ios' ? 7 : 5;
            tabViewProps.maxToRenderPerBatch = 5;
        } else {
            tabViewProps.windowSize = 3;
            tabViewProps.maxToRenderPerBatch = 2;
            tabViewProps.updateCellsBatchingPeriod = 200;
        }
        return tabViewProps;
    }

    cancelPendingRequests = () => {
        const { pages } = this.state;
        for (let i = 0; i < pages.length; i += 1) {
            const cancelToken = this.cancelTokenMap[i];
            if (cancelToken) {
                cancelToken.cancel();
                this.cancelTokenMap[i] = undefined;
            }
        }
    }

    findFavoritePageIndex = (pages) => {
        for (let i = 0; i < pages.length; i += 1) {
            if (pages[i].isForFavorites) {
                return i;
            }
        }
        return -1;
    }

    loadMoreInTab = (tab) => {
        if (!this.fetchTabDataFunctions[tab]) {
            this.fetchTabDataFunctions[tab] = this.createFetchTabDataFunction(tab);
        }
        this.fetchTabDataFunctions[tab]();
    }

    createFetchTabDataFunction = tab => () => {
        const { pages } = this.state;
        const activeTabPageInfo = pages[tab];

        if (!activeTabPageInfo || activeTabPageInfo.endReached) {
            return;
        }

        let cancelToken = this.cancelTokenMap[tab];
        if (cancelToken) {
            cancelToken.cancel();
            this.cancelTokenMap[tab] = undefined;
        }

        cancelToken = getCancelToken();
        this.cancelTokenMap[tab] = cancelToken;

        this.fetchData({
            foodCategory: activeTabPageInfo.foodCategory,
            page: activeTabPageInfo.currentPageIndex + 1,
            tab,
            cancelToken,
        });
    };

    fetchData = async ({
        page,
        tab,
        cancelToken,
    }) => {
        try {
            const { rootStore } = this.props;
            const { pages, sortType } = this.state;
            const currentTabPage = pages[tab];

            const {
                foodCategory,
                isForBestCategory,
                isForFavorites,
                isForEvents,
                isForRecommendCategory,
            } = currentTabPage;

            const branchStore = rootStore.getStore('branchStore');
            const result = await branchStore.getVendorsForList({
                foodCategory,
                isForBestCategory,
                isForFavorites,
                isForEvents,
                isForRecommendCategory,
                page,
                sortType,
                networkParameters: {
                    cancelToken: cancelToken.token,
                },
            });

            if (result.error && result.code === Globals.ERROR_CODE_CANCEL) {
                return;
            }

            this.setState((prevState) => {
                let needToUpdatePages = false;

                const newPages = prevState.pages.slice(0);
                const newTabPage = { ...newPages[tab] };
                newPages[tab] = newTabPage;
                const newState = {};

                if (newTabPage.refreshing) {
                    needToUpdatePages = true;
                    newTabPage.refreshing = false;
                }

                if (result.error || newTabPage.currentPageIndex >= page) {
                    if (needToUpdatePages) {
                        newState.pages = newPages;
                        return newState;
                    }

                    return null;
                }

                if (!result.vendors || result.vendors.length < 1) {
                    needToUpdatePages = true;
                    newTabPage.endReached = true;
                } else {
                    const userStore = rootStore.getStore('userStore');
                    // The data from server and the schema to show the list are different.
                    const transformed = ListHelper.ShopList.getTransformedVendorData({
                        vendors: result.vendors,
                        displayFavorite: userStore.getUser().isValid(),
                    });

                    newTabPage.pageData = _.concat(newTabPage.pageData, transformed);
                    if (newTabPage.isForBestCategory || newTabPage.isForRecommendCategory) {
                        newTabPage.endReached = true;
                    }
                    needToUpdatePages = true;
                }

                if (needToUpdatePages) {
                    newTabPage.currentPageIndex = page;
                    newState.pages = newPages;

                    return newState;
                }

                return null;
            });
        } catch (error) {
            // eslint-disable-next-line
            console.log('[fetchData] error:', error);
        }
    }

    processAnalyticCategory = (params) => {
        const { index } = params;
        try {
            const { pages } = this.state;
            const categoryName = _.get(pages, [`${index}`, 'foodCategoryForAnalytic'], undefined);
            if (categoryName) {
                FirebaseHelper.analyticsLogEventForSingle({
                    eventName: categoryName,
                });
            }
        } catch (error) {
            console.error(error);
        }
    }

    onChangeTab = (index) => {
        this.setState((prevState) => {
            const { activeTab } = prevState;
            if (index === activeTab) {
                return null;
            }
            this.processAnalyticCategory({ index });
            return { activeTab: index };
        }, () => {
            const { pages } = this.state;
            // This upcoming page is not initialized(not loaded the data)
            if (pages[index].currentPageIndex === -1) {
                this.loadMoreInTab(index);
            }
        });
    }

    onEndReached = (index) => {
        // https://github.com/Flipkart/recyclerlistview/issues/64
        const { pages } = this.state;
        if (pages[index].currentPageIndex === -1) {
            return;
        }
        this.loadMoreInTab(index);
    }

    onContentSizeChange = (_width, height, index) => {
        const { pages } = this.state;

        if (pages[index].currentPageIndex >= 0) {
            if (this.pageMaxHeightMap[index] != null
                && this.pageMaxHeightMap[index] >= height) {
                return;
            }
            this.pageMaxHeightMap[index] = height;
            this.onContentSizeExpand(height, index);
        }
    }

    onContentSizeExpand = (size, index) => {
        const { tabAnimProps } = this.state;

        ShopListScene.setNodeMaxValue(
            tabAnimProps,
            this.getScrollMaxValueForSize(size),
            index,
        );
    }

    getScrollMaxValueForSize = (size) => {
        const maxValue = size - this.tabViewRef.current.getPageHeight();
        return Math.max(0, maxValue);
    }

    onItemPress = (data) => {
        if (data.vendorId === 'none') {
            return;
        }
        const { navigation } = this.props;
        navigation.navigate('ShopDetailScene', {
            vendorId: data.vendorId,
        });
        FirebaseHelper.analyticsLogEvent({
            checkEvents: {
                [EVENT_NAME_TABLE.RDShopList]: EVENT_NAME_TABLE.RDShopDetail,
            },
        });
    }

    onItemFavoritePress = async (data, index) => {
        const { rootStore } = this.props;
        const userStore = rootStore.getStore('userStore');

        if (this.favCancelToken) {
            this.favCancelToken.cancel();
        }
        this.favCancelToken = getCancelToken();
        const result = await userStore.setFavorite({
            vendorId: data.vendorId,
            isFavorited: !data.favorite,
            networkParameters: {
                cancelToken: this.favCancelToken.token,
            },
        });

        if (result.error) {
            return;
        }

        this.updateLocalFavoriteData(data, index);
    }

    updateLocalFavoriteData = (data, index) => {
        const { pages, activeTab, sortType } = this.state;
        const newPages = pages.slice(0);

        const newFavoritePage = this.getResettedPage(newPages[this.favoriteIndex]);
        newPages[this.favoriteIndex] = newFavoritePage;

        if (activeTab === this.favoriteIndex) {
            const cancelToken = this.cancelTokenMap[this.favoriteIndex];
            if (cancelToken) {
                cancelToken.cancel();
            }
            this.setState({ pages: newPages, scrollEnabled: false }, () => {
                this.tabViewRef.current.setSearchBarState(true, () => {
                    this.resetAllPages(sortType, this.onPagesReset);
                });
            });
            return;
        }

        this.resetFavoritePage(data, index);
    }

    resetFavoritePage = (data, index) => {
        const { activeTab } = this.state;

        if (Platform.OS === 'ios' && Globals.APP_MODE === DEV_MODE) {
            // Hack for IOS in __DEV__ mode since RN currently has a bug which causes a crash
            // when you recreate animation props for diffclamp
            this.resetFavAnimStateDevIOS();
        } else {
            this.resetFavAnimState();
        }

        this.pageMaxHeightMap[this.favoriteIndex] = undefined;
        this.tabViewRef.current.setScrollValueOffset(this.favoriteIndex, 0);

        this.setState((prevState) => {
            const { pages } = prevState;
            const newPages = pages.slice(0);
            newPages[activeTab] = { ...newPages[activeTab] };
            const newPageData = newPages[activeTab].pageData.slice(0);

            const newFavoritePage = this.getResettedPage(newPages[this.favoriteIndex]);
            newPages[this.favoriteIndex] = newFavoritePage;

            const newVendor = { ...newPageData[index] };
            newVendor.favorite = !data.favorite;
            newPageData[index] = newVendor;
            newPages[activeTab].pageData = newPageData;

            return { pages: newPages };
        });
    }

    resetFavAnimState = () => {
        const { pages } = this.state;
        const resetIndexData = {};
        resetIndexData[this.favoriteIndex] = 0;

        const offsetData = this.tabViewRef.current.getResetDiffClampOffsets(resetIndexData);
        // TODO: Instead of this flow, send offsetData through props and let ShopListTabView
        // handle everything through componentDidUpdate
        this.tabViewRef.current.prepareForDiffClampReset(offsetData);

        const { offsetValue, scrollValues } = offsetData;
        const tabAnimProps = this.createTabAnimProps(
            pages.length,
            scrollValues,
            offsetValue,
        );

        // Initial max values are not working for some reason
        // so we have to set it afterwards like this
        for (let i = 0; i < pages.length; i += 1) {
            if (this.pageMaxHeightMap[i] != null) {
                ShopListScene.setNodeMaxValue(
                    tabAnimProps,
                    this.getScrollMaxValueForSize(this.pageMaxHeightMap[i]),
                    i,
                );
            }
        }

        this.setState({ tabAnimProps });
    }

    resetFavAnimStateDevIOS = () => {
        const currentOffsetValue = this.tabViewRef.current.getOffsetValue();
        const favScrollOffset = this.tabViewRef.current.getScrollValueOffset(this.favoriteIndex);
        const newOffsetValue = currentOffsetValue + favScrollOffset;

        const { tabAnimProps } = this.state;
        const { scrollValues, offsetValue } = tabAnimProps.animationProps;

        scrollValues[this.favoriteIndex].scrollValue.setValue(0);
        offsetValue.setValue(newOffsetValue);
        global.requestAnimationFrame(() => {
            this.tabViewRef.current.snapOffsetValue();
        });
    }

    processAnalytic = () => {
        FirebaseHelper.analyticsLogEvent({
            eventName: EVENT_NAME_TABLE.BYSSShopListSearch,
        });
    }

    getResettedPage = (page) => {
        const resettedPage = { ...page };
        resettedPage.pageData = [];
        resettedPage.currentPageIndex = -1;
        resettedPage.endReached = false;

        return resettedPage;
    }

    onRefresh = (index) => {
        const { pages, activeTab } = this.state;
        if (!pages[index]
            || activeTab !== index) {
            return;
        }
        const newPages = pages.slice(0);
        const newPage = this.getResettedPage(newPages[index]);
        newPage.refreshing = true;
        newPages[index] = newPage;

        this.pageMaxHeightMap[index] = undefined;

        this.setState({ pages: newPages }, () => {
            this.loadMoreInTab(index);
        });
    }

    onChangeSorter = (sortType) => {
        const { sortType: stateSortType } = this.state;
        if (sortType === stateSortType) {
            return;
        }
        const { rootStore } = this.props;
        const sceneStore = rootStore.getStore('sceneStore');
        sceneStore.setActiveShopListSortType(sortType);

        const nonSortablePages = this.getNonSortablePages();
        this.resetAllPages(sortType, () => {
            const { pages, activeTab } = this.state;

            const newPages = pages.slice(0);
            _.forOwn(nonSortablePages, (nonSortablePage, key) => {
                newPages[key] = nonSortablePage;
            });
            this.setState({ pages: newPages });

            if (ShopListScene.isNonSortablePage(newPages[activeTab])) {
                return;
            }
            this.onPagesReset();
        });
    }

    getNonSortablePages = () => {
        const { pages } = this.state;
        const nonSortablePages = {};
        pages.forEach((page, index) => {
            if (ShopListScene.isNonSortablePage(page)) {
                nonSortablePages[index] = page;
            }
        });
        return nonSortablePages;
    }

    resetAllPages = (sortType, callback) => {
        this.tabViewRef.current.resetAllCalculations();
        this.cancelPendingRequests();
        this.pageMaxHeightMap = {};
        const pages = ShopListScene.generatePagesFromProps(this.props);

        const { tabAnimProps } = this.state;
        const { scrollValues, offsetValue } = tabAnimProps.animationProps;

        this.setState({
            sortType,
            pages,
            navBarAnimDisabled: true,
            scrollEnabled: false,
        }, () => {
            // Hack to reset the diff clamp internals without
            // affecting the user experience since
            // there is currently a bug in React Native
            // that prevents you from unmounting a diffclamp
            // without having it crashing in dev mode on IOS

            offsetValue.setValue(Number.MAX_SAFE_INTEGER);
            global.requestAnimationFrame(() => {
                scrollValues.forEach(({ scrollValue }) => {
                    scrollValue.setValue(0);
                });
                offsetValue.setValue(0);
                this.setState({ navBarAnimDisabled: false, scrollEnabled: true }, () => {
                    if (callback) {
                        callback();
                    }
                });
            });
        });
    }

    onPagesReset = () => {
        const { activeTab, pages } = this.state;
        if (pages[activeTab].currentPageIndex === -1) {
            this.loadMoreInTab(activeTab);
        }
    }

    onChangeText = (searchText, callback) => {
        this.setState({ searchText }, callback);
    }

    onPressClear = () => { this.onChangeText(''); }

    onSubmitEditing = () => {
        const { searchText } = this.state;
        const { navigation } = this.props;
        if (searchText && searchText.length > 0) {
            navigation.navigate('ShopSearchScene', {
                keyword: searchText,
                onItemFavoritePress: () => {
                    const { sortType } = this.state;
                    this.resetAllPages(sortType, this.onPagesReset);
                },
            });
            this.processAnalytic();
            return;
        }
        Toast.show(i18n.t('empty_search_word'), Toast.SHORT);
    }

    onDidBlur = () => {
        this.setState({ searchText: undefined });
    }

    getInitialPageIndex = () => {
        const { navigation } = this.props;
        if (this.initialPageIndex == null) {
            const category = navigation.getParam('category', '');
            this.initialPageIndex = Math.max(0, this.getPageIndex(category));
        }

        return this.initialPageIndex;
    }

    getPageIndex = (category) => {
        const { pages } = this.state;
        for (let i = 0; i < pages.length; i += 1) {
            const page = pages[i];
            if (page.foodCategory === category) {
                return i;
            }
        }
        return -1;
    }

    onPressHistoryItem = (text) => {
        this.onChangeText(text, this.onSubmitEditing);
    }

    isSorterDisabled = () => {
        const { pages, activeTab } = this.state;
        const page = pages[activeTab] || {};

        return ShopListScene.isNonSortablePage(page);
    }

    render() {
        const { navigation } = this.props;
        const {
            pages,
            activeTab,
            sortType,
            searchText,
            tabAnimProps,
            navBarAnimDisabled,
            scrollEnabled,
            userId,
        } = this.state;

        if (pages.length < 1) {
            return null;
        }

        let clampedScroll;
        if (tabAnimProps.animationProps) {
            clampedScroll = tabAnimProps.animationProps.clampedScroll || clampedScroll;
        }
        const initialPage = this.getInitialPageIndex();

        return (
            <View style={styles.rootView}>
                <View style={[
                    styles.tabViewContainer,
                    { top: NavigationSearchBar.getCollapsedHeight() },
                ]}
                >
                    <NavigationEvents onDidBlur={this.onDidBlur} />
                    <ShopListTabView
                        key={`tabView${userId}`}
                        ref={this.tabViewRef}
                        data={pages}
                        onViewableTabChanged={this.onChangeTab}
                        contentProps={this.tabViewProps}
                        onPageEndReached={this.onEndReached}
                        onContentSizeChange={this.onContentSizeChange}
                        onItemPress={this.onItemPress}
                        onItemFavoritePress={this.onItemFavoritePress}
                        onRefresh={this.onRefresh}
                        activeTab={activeTab}
                        barHeight={NavigationSearchBar.getHeight()}
                        collapsedBarHeight={NavigationSearchBar.getCollapsedHeight()}
                        initialPage={initialPage}
                        navBarAnimDisabled={navBarAnimDisabled}
                        scrollEnabled={scrollEnabled}
                        pageOnEndReachedThreshold={ShopListScene.ONEND_REACHED_THRESHOLD}
                        {...tabAnimProps}
                    />
                    <CartShortcutButton navigation={navigation} />
                </View>
                <NavigationSearchBar
                    title={i18n.t('shop_list_scene_title')}
                    navigator={navigation}
                    showSorter={!this.isSorterDisabled()}
                    sorter={Globals.SHOPLIST_SORTER}
                    onChangeSorter={this.onChangeSorter}
                    initialSortType={sortType}
                    showLocation
                    showRecentSearch
                    onPressHistoryItem={this.onPressHistoryItem}
                    placeholder={i18n.t('shop_list_searchbar_placeholder')}
                    scrollValue={navBarAnimDisabled ? undefined : clampedScroll}
                    onSubmitEditing={this.onSubmitEditing}
                    onChangeText={this.onChangeText}
                    onPressClear={this.onPressClear}
                    value={searchText}
                />
                {this.renderPopover()}
            </View>
        );
    }
}

export default injectStore({ component: ShopListScene, observe: false });

const styles = StyleSheet.create({
    rootView: {
        flex: 1,
        width: '100%',
        backgroundColor: StyleConfig.WHITE_FOUR,
    },
    tabViewContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
    },
    popoverTextContainer: {
        marginVertical: wsv(7),
    },
    popoverStyle: {
        width: wsv(190),
        height: wsv(40),
        backgroundColor: StyleConfig.BLACK,
    },
    distanceComment1: {
        ...textStyles.regularText,
        fontSize: wsv(10),
        lineHeight: wsv(13),
        color: StyleConfig.WHITE_FOUR,
        textAlign: 'left',
        alignSelf: 'center',
    },
});