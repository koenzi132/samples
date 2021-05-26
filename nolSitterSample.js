import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  SafeAreaView,
  View,
  StyleSheet,
  Modal,
  Alert,
  Animated,
  TouchableOpacity,
  Image,
  Linking,
  Platform,
  AppState,
  FlatList,
} from 'react-native'
import _ from 'underscore'
import moment from 'moment'
import queryString from 'query-string'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Airbridge from 'airbridge-react-native-sdk'
import FontAwesome from 'react-native-vector-icons/FontAwesome'
import { fromToTime, getTimeFromIndex } from 'noldam-utils/time'
import call from 'react-native-phone-call'
import Swiper from 'react-native-swiper'

import { Toast, RatioText } from '../../components/Base'
import NavigationService from '../../lib/NavigationService'
import { banners, programsImgs, programsLink } from '../../lib/strings'
import ChannelModule from '../../lib/ChannelModule'
import { SlideSheet, ApplicationView, AppliedView } from '../../components/Calendar'
import CoronaCheckScreen from './CoronaCheckScreen'
import {
  screenHeight,
  screenRatio,
  colors,
  customStyle,
} from '../../lib/styleUtils'
import { askGeolocationPermission } from '../../lib/utils'
import PushModule from '../../lib/PushModule'
import { fetchKakaoMapUri } from '../../lib/api/request'
import * as serviceActions from '../../redux/modules/service'
import * as scheduleActions from '../../redux/modules/schedule'
import * as requestActions from '../../redux/modules/request'

const REMOVE = 'remove'
const JUDGEMENT = 'judgement'
const INTERVIEW = 'interview'
const SCHEDULE_TODAY = 'scheduleToday'

const SLIDE_HEIGHT = 430
const SCHEDULE_SLIDE_HEIGHT = 450

const SLIDE_INNER_VIEW = (
  title,
  desc,
  mainButtonText,
  subButtonText,
  onPressMainButton,
  onPressSubButton,
) => (
  <View style={styles.slideInnerView}>
    <Image
      source={require('../../images/imgAlarm.png')}
      style={{ marginTop: 26 }}
    />
    <RatioText bold size={18} style={{ marginTop: 15, marginBottom: 12 }}>
      {title}
    </RatioText>
    {
      typeof desc === 'string' ? (
        <RatioText size={13} lineHeight={23} style={{ textAlign: 'center' }}>
          {desc}
        </RatioText>
      ) : desc
    }
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.interviewButton}
      onPress={onPressMainButton}
    >
      <RatioText color='white' bold>
        {mainButtonText}
      </RatioText>
    </TouchableOpacity>
    <TouchableOpacity
      activeOpacity={0.8}
      style={{ marginTop: 25 }}
      hitSlop={{ top: 20, bottom: 20, left: 40, right: 40 }}
      onPress={onPressSubButton}
    >
      <RatioText color='black06'>
        {subButtonText}
      </RatioText>
    </TouchableOpacity>
  </View>
)

const ScheduleSlideAdresView = (adres, schedule) => (
  <>
    <View style={{ flexDirection: 'row' }}>
      <RatioText size={13} bold style={{ marginRight: 10 }}>
        장소
      </RatioText>
      <RatioText size={13}>
        {adres}
      </RatioText>
    </View>
    <View style={{ flexDirection: 'row', marginTop: 7 }}>
      <RatioText size={13} bold style={{ marginRight: 10 }}>
        일정
      </RatioText>
      <RatioText size={13}>
        {schedule}
      </RatioText>
    </View>
  </>
)

const FindPlayScreen = ({
  profile,
  navigation,
  coronaCheck,
  scheduleToday,
  notices,
  villagesData,
  ServiceActions,
  ScheduleActions,
  RequestActions,
}) => {
  const [slideY] = useState(new Animated.Value(screenHeight))
  const [slideVisible, setSlideVisible] = useState(false)
  const [slideType, setSlideType] = useState('')
  const [slideOpened, setSlideOpened] = useState(false)

  const [selectedTab, setSelectedTab] = useState(0)

  const [tabValue] = useState(new Animated.Value(0))
  const [tabAppeared, setTabAppeared] = useState(false)
  const [secondTabAppeared, setSecondTabAppeared] = useState(false)

  const [interviewChecked, setInterviewChecked] = useState(false)
  const [scheduleChecked, setScheduleChecked] = useState(false)

  const [applications, setApplications] = useState([])
  const [page, setPage] = useState(0)
  const [isEnd, setIsEnd] = useState(false)

  const [appliedList, setAppliedList] = useState([])
  const [appliedPage, setAppliedPage] = useState(1)
  const [appliedLastPage, setAppliedLastPage] = useState(1)

  const toastRef = useRef(null)

  useEffect(() => {
    const fetchDatas = async () => {
      initialize()
  
      if (Platform.OS === 'ios') {
        const pushAgreed = await AsyncStorage.getItem('pushAgreed').catch(() => {})
  
        if (pushAgreed !== 'true') {
          const hasPermission = await PushModule.checkPermission()
  
          if (hasPermission) {
            PushModule.registerToken(true)
            await AsyncStorage.setItem('pushAgreed', 'true')
          }
        }
      }
      AppState.addEventListener('change', handleAppStateChange)
  
      if (typeof profile.recommendOption !== 'number') {
        navigation.navigate('RecommendAlarm')
      }
    }
    fetchDatas()

    return () => {
      AppState.removeEventListener('change', handleAppStateChange)
    }
  }, [])


  const initialize = async () => {
    if (!coronaCheck) {
      checkIfNotice()
      checkDeepLink()
    }
    await RequestActions.fetchVillages().catch(() => {})

    initApplications()

    await ScheduleActions.fetchScheduleToday().catch(() => {})

    if (!slideOpened) {
      checkSlideAppear()
    }

    if (profile && profile.judgeStatus) {
      const { judgeStatus } = profile

      if (judgeStatus === 'fail') {
        NavigationService.navigate('JudgeEnd', { pass: false })
      } else if (judgeStatus === 'passNoti') {
        NavigationService.navigate('JudgeEnd', { pass: true })
      }
    }
  }

  const initApplications = () => {
    RequestActions.fetchApplications(0).then(response => {
      const { list, end } = response.data

      setApplications(list)
      setIsEnd(end)
      setPage(0)
    })
  }

  const initAppliedList = () => {
    RequestActions.fetchApplyList(1).then(response => {
      const { lastPage, list } = response.data

      setAppliedList(list)
      setAppliedLastPage(lastPage)
      setAppliedPage(1)
    })
  }

  const handleAppStateChange = nextState => {
    if (nextState === 'active') {
      checkDeepLink()
    }
  }

  const onChangeSlide = type => {
    if (!slideOpened) {
      if (type === REMOVE) {
        setSlideType('')
        setSlideOpened(false)
        setSlideVisible(false)
        return
      }

      const targetType = type || slideType

      setSlideType(targetType)
      setSlideVisible(true)
      setSlideOpened(true)

      let height = SLIDE_HEIGHT

      if (type === SCHEDULE_TODAY) {
        const isSpecial = !!((typeof scheduleToday[0].special === 'string') && (scheduleToday[0].special !== 'normal') && (scheduleToday[0].special !== 'group'))
        
        if (isSpecial) {
          height = SCHEDULE_SLIDE_HEIGHT
        }
      }

      Animated.timing(slideY, {
        toValue: screenHeight - height,
        duration: 250,
        useNativeDriver: true,
      }).start()
    } else if (type === REMOVE) {
      setSlideType('')
      setSlideOpened(false)
      setSlideVisible(false)
    }
  }

  const checkSlideAppear = () => {
    if (!slideOpened) {
      let interviewModal = false

      if (profile.interview && profile.interview.date) {
        const { date, start } = profile.interview
        const dateDiff = moment(date).diff(moment(), 'days')

        if (dateDiff >= 0) {
          interviewModal = true
        } else if (dateDiff === 0) {
          const hour = Math.floor(start)
          const min = start - hour === 0.5 ? 30 : 0

          const tempTime = moment().hour(hour).minute(min)
          const timeDiff = moment(tempTime).diff(moment(), 'minutes')

          if (timeDiff > 0) {
            interviewModal = true
          }
        }
      }

      if (interviewModal && !interviewChecked) {
        onChangeSlide(INTERVIEW)
      } else if (!profile.judge) {
        onChangeSlide(JUDGEMENT)
      } else if (!_.isEmpty(scheduleToday) && !scheduleChecked) {
        onChangeSlide(SCHEDULE_TODAY)
      }
    }
  }

  const onPressCallParent = useCallback(number => () => {
    const args = { number }
    call(args).catch(console.error)
  }, [])

  const closeSlide = type => () => {
    if (type === INTERVIEW) {
      setInterviewChecked(true)
    } else if (type === SCHEDULE_TODAY) {
      setScheduleChecked(true)
    }
    onChangeSlide(REMOVE)
  }

  const onPressGuide = useCallback(obj => () => {
    const { special, option1 } = obj

    let url = ''

    if (typeof option1 === 'number') {
      url = programsLink[special][option1]
    } else {
      url = programsLink[special]
    }

    if (url) {
      Linking.canOpenURL(url).then(() => {
        Linking.openURL(url).catch(() => {
          Alert.alert('오류 발생', '링크를 열 수 없습니다')
        })
      })
    }
  }, [])

  const renderSlideModal = () => {
    let customContent = null
    let containerStyle = {}
    let slideHeight = SLIDE_HEIGHT

    if (slideType === JUDGEMENT) {
      const title = '심사 통과 후 활동을 시작할 수 있어요'
      const desc = '놀담 시터로 활동하기 위해서 심사 과정을 거쳐야합니다\n심사를 진행해주세요'

      customContent = SLIDE_INNER_VIEW(
        title,
        desc,
        '심사 진행하기',
        '나중에 할게요',
        onPressNavigate('Judgement'),
        closeSlide(JUDGEMENT)
      )
    } else if (slideType === SCHEDULE_TODAY) {
      const {
        adres_base: adresBase,
        adres_detail: adresDetail,
        start,
        hour,
        phone,
      } = scheduleToday[0]

      const adres = `${adresBase} ${adresDetail}`
      const schedule = `${moment().format('MM월 DD일 (ddd)')} ${fromToTime(start, hour, 'A h:mm')}`

      let specialObj = {}

      if ((typeof scheduleToday[0].special === 'string') && (scheduleToday[0].special !== 'normal') && (scheduleToday[0].special !== 'group')) {
        specialObj = {
          special: scheduleToday[0].special,
          option1: scheduleToday[0].option1,
        }
        containerStyle = {
          paddingHorizontal: 0,
          backgroundColor: null,
        }
        slideHeight = SCHEDULE_SLIDE_HEIGHT
      }

      customContent = !_.isEmpty(specialObj) ? (
        <>
          <TouchableOpacity
            activeOpacity={0.8}
            hitSlop={{ top: 30, bottom: 30, left: 30, right: 30 }}
            onPress={closeSlide(SCHEDULE_TODAY)}
            style={{ marginBottom: 12, marginLeft: 24 }}
          >
            <RatioText bold color='white'>
              닫기
            </RatioText>
          </TouchableOpacity>
          <View style={styles.scheduleView}>
            <Image source={programsImgs[specialObj.special].main} style={styles.playTodayImg} />
            <View style={{ paddingHorizontal: 24 }}>
              <RatioText style={{ marginTop: 22, marginBottom: 14, textAlign: 'center' }} bold size={18}>
                오늘 놀이가 있어요
              </RatioText>
              {ScheduleSlideAdresView(adres, schedule)}
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.scheduleButton, { marginTop: 28, marginBottom: 12 }]}
                onPress={onPressGuide(specialObj)}
              >
                <RatioText bold color='white'>
                  가이드 보기
                </RatioText>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.scheduleButton, { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.main }]}
                onPress={onPressCallParent(phone)}
              >
                <RatioText>
                  전화하기
                </RatioText>
              </TouchableOpacity>
            </View>
          </View>
        </>
      ) : SLIDE_INNER_VIEW(
        '오늘 놀이가 있어요',
        (
          <View style={{ width: '100%' }}>
            {ScheduleSlideAdresView(adres, schedule)}
          </View>
        ),
        '전화하기',
        '확인했어요',
        onPressCallParent(phone),
        closeSlide(SCHEDULE_TODAY)
      )
    } else if (slideType === INTERVIEW) {
      const { date, start } = profile.interview
      const isPrecisely = (start - Math.floor(start)) !== 0.5

      const dateText = `${moment(date).format('MM월 DD일')}`
      const timeText = isPrecisely ? getTimeFromIndex(start, 'A h시') : getTimeFromIndex(start, 'A h시mm분')
      const desc = `${dateText} ${timeText}에 온라인 인터뷰가\n예정되어 있습니다`

      customContent = SLIDE_INNER_VIEW(
        '온라인 인터뷰 안내',
        desc,
        '확인했어요',
        '일정 변경하기',
        closeSlide(INTERVIEW),
        onPressNavigate('Interview', { hasInterview: true }))
    }

    return (
      <SlideSheet
        customContent={customContent}
        slideY={slideY}
        slideOpened={slideOpened}
        slideStyle={[{ height: slideHeight }, containerStyle]}
      />
    )
  }

  const checkIfNotice = async () => {
    try {
      if (_.isEmpty(notices)) {
        return
      }

      const lastNoticeIndex = await AsyncStorage.getItem('lastNoticeIndex')

      if (!_.isEmpty(lastNoticeIndex)) {
        const newNotices = notices.filter(
          notice => notice.id > parseInt(lastNoticeIndex, 10)
        )
        ServiceActions.setNewNotices({ newNotices })
      }

      if (_.isEmpty(lastNoticeIndex)) {
        AsyncStorage.setItem('lastNoticeIndex', `${notices[0].id}`)
      }
    } catch (error) {
      console.log(error)
    }
  }

  const checkDeepLink = () => {
    Airbridge.deeplink.setDeeplinkListener(deeplinkCallback)
  }

  const deeplinkCallback = deeplink => {
    if (typeof deeplink === 'string') {
      const scheme = 'noldamsitter://'
      const scheme2 = 'https://noldamsitter.airbridge.io/'
      let path = null

      const tempArr = deeplink.split('?')

      if (tempArr[0].substring(0, scheme.length) === scheme) {
        path = tempArr[0].substring(scheme.length)
      } else if (tempArr[0].substring(0, scheme2.length) === scheme2) {
        path = tempArr[0].substring(scheme2.length)
      }

      if (path) {
        const { query } = queryString.parseUrl(deeplink)
        NavigationService.navigate(path, query)
      }
    }
  }

  const onPressNavigate = useCallback((screen, params) => () => {
    navigation.navigate(screen, params)
  }, [])

  const onPressFindVillage = useCallback(() => {
    navigation.navigate('SettingAdres', {
      initApplications,
    })
  }, [])

  const renderTopView = () => (
    <View style={styles.topView}>
      <RatioText size={22} bold>
        놀이 찾기
      </RatioText>
      <TouchableOpacity
        style={styles.settingVillage}
        onPress={onPressFindVillage}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.8}
      >
        <FontAwesome
          name='angle-down'
          size={22}
          color={colors.black}
          style={{ marginRight: 5 }}
        />
        <RatioText size={17} bold>
          동네 설정
        </RatioText>
      </TouchableOpacity>
    </View>
  )

  const deleteVillage = item => async () => {
    if (item) {
      await RequestActions.deleteVillage(item.adres_id)
      initApplications()
    }
  }

  const renderVillages = () => !_.isEmpty(villagesData) && (
    <View style={styles.villageView}>
      {villagesData.locations.map((item, index) => (
        <View
          style={[styles.village, index > 0 && { marginLeft: 4 }]}
          key={index}
        >
          <RatioText size={13}>
            {item.adres_depth3_h}
          </RatioText>
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={deleteVillage(item)}
            activeOpacity={0.8}
          >
            <Image
              source={require('../../images/close.png')}
              style={{ width: 8, height: 8, marginLeft: 3 }}
            />
          </TouchableOpacity>
        </View>
      ))}   
    </View>
  )

  const onSelectTab = useCallback(index => () => {
    if (selectedTab !== index) {
      setSelectedTab(index)

      if (index === 0) {
        setAppliedList([])
        setSecondTabAppeared(false)
        initApplications()
      } else {
        setApplications([])
        setTabAppeared(false)
        initAppliedList()
      }
    }
  }, [selectedTab])

  const onEndReached = async () => {
    if (selectedTab === 0) {
      if (!isEnd) {
        const newPage = page + 1

        RequestActions.fetchApplications(newPage).then(response => {
          const { list, end } = response.data
          const newList = applications.concat(list)

          setApplications(newList)
          setIsEnd(end)
          setPage(newPage)
        })
      }
    } else if (appliedPage < appliedLastPage) {
      const newPage = appliedPage + 1

      RequestActions.fetchApplyList(newPage).then(response => {
        const { lastPage, list } = response.data
        const newList = appliedList.concat(list)

        setAppliedList(newList)
        setAppliedLastPage(lastPage)
        setAppliedPage(newPage)
      })
    }
  }

  const renderTab = () => (
    <View style={styles.tab}>
      {['지원 가능한 놀이', '지원한 놀이'].map((item, index) => {
        const isSelected = selectedTab === index
        return (
          <View key={index} style={{ alignItems: 'center' }}>
            <TouchableOpacity
              onPress={onSelectTab(index)}
              activeOpacity={0.8}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            >
              <RatioText color={isSelected ? 'black09' : 'black06'} bold={isSelected}>
                {item}
              </RatioText>
            </TouchableOpacity>
            <View style={[{ marginTop: 12, width: 150 * screenRatio }, isSelected && { borderTopWidth: 2, borderTopColor: colors.main }]} />
          </View>
        )}
      )}
    </View>
  )

  const onPressApplicationDetail = async item => {
    if (profile.judge) {
      if (selectedTab === 0) {
        const expiryDate = moment(item.expiry_date)
        const dateDiff = expiryDate.diff(moment())
  
        if (dateDiff <= 0) {
          if (toastRef && toastRef.current && (typeof toastRef.current.show === 'function')) {
            toastRef.current.show('기간이 만료된 신청서입니다')
          }
          initApplications()
          return
        }
      }
      navigation.navigate('ApplicationDetail', {
        id: item.id,
        initApplications,
        initAppliedList,
      })
    } else {
      Alert.alert('지원 불가', '서류 심사 통과 이후에\n지원이 가능합니다')
    }
  }

  const onPressBanner = useCallback(type => () => {
    const target = _.find(banners, item => item.type === type)

    if (target) {
      if (target.url) {
        Linking.openURL(target.url).catch(() => {})
      } else {
        navigation.navigate(target.screen)
      }
    }
  }, [banners])

  const renderPages = (index, total) => {
    const pageNumber = `${index + 1}/${total}`
    return (
      <View style={styles.bannerPage}>
        <RatioText size={7 * screenRatio} color='white'>
          {pageNumber}
        </RatioText>
      </View>
    )
  }

  const renderBanner = useMemo(() => (
    <View style={{ marginTop: 20, height: 60 * screenRatio }}>
      <Swiper
        style={{ height: 60 * screenRatio }}
        horizontal
        renderPagination={renderPages}
      >
        {
          banners.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.banner}
              onPress={onPressBanner(item.type)}
              activeOpacity={0.8}
            >
              <Image
                source={item.image}
                style={{
                  width: 326 * screenRatio,
                  height: 51 * screenRatio,
                }}
              />
            </TouchableOpacity>
          ))
        }
      </Swiper>
    </View>
  ), [])

  const renderHeader = () => (
    <View style={{ backgroundColor: colors.white }}>
      {renderBanner}
      {renderTopView()}
      {renderVillages()}
      {renderTab()}
    </View>
  )

  const onPressFindWay = async adres => {
    if (adres) {
      const kakaoUri = await fetchKakaoMapUri(adres)

      if (kakaoUri) {
        await askGeolocationPermission()
        navigation.navigate('WebView', { uri: kakaoUri })
      } else {
        Alert.alert('오류', '지도를 불러오지 못했습니다')
      }
    }
  }

  const renderItem = ({ item, index }) => (
    <ApplicationView
      index={index}
      item={item}
      rank={profile.rank}
      onPressApplicationDetail={onPressApplicationDetail}
      onPressFindWay={onPressFindWay}
    />
  )

  const onPressAppliedDetail = useCallback(item => {
    navigation.navigate('ApplicationDetail', {
      id: item.request_id,
      status: item.status,
      initApplications,
      initAppliedList,
    })
  }, [])

  const renderAppliedItem = ({ item, index }) => (
    <AppliedView
      index={index}
      item={item}
      onPressAppliedDetail={onPressAppliedDetail}
    />
  )

  const renderEmptyView = () => {
    const desc = selectedTab === 0 ? '설정된 지역에 놀이가 없습니다\n동네 설정에서 지역을 넓혀보세요' : '아직 지원한 놀이가 없어요'
    return (
      <View style={styles.emptyView}>
        <Image source={require('../../images/notice.png')} />
        <RatioText style={{ marginTop: 25, textAlign: 'center' }} size={19} lineHeight={29} color='black04'>
          {desc}
        </RatioText>
      </View>
    )
  }

  const applicationKeyExtractor = item => String(item.id)
  const appliedKeyExtractor = item => String(item.request_id)

  const onScroll = tabIndex => e => {
    const { y } = e.nativeEvent.contentOffset
    const boundary = 200

    if ((tabIndex === 0) && (selectedTab === 0)) {
      if (!_.isEmpty(applications) && !tabAppeared && (y >= boundary)) {
        setTabAppeared(true)
        Animated.timing(tabValue, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }).start()
      } else if (tabAppeared && (y < boundary)) {
        Animated.timing(tabValue, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start(() => { setTabAppeared(false) })
      }
    } else if (!_.isEmpty(appliedList) && (tabIndex === 1) && (selectedTab === 1)) {
      if (!tabAppeared && (y >= boundary)) {
        setSecondTabAppeared(true)
        Animated.timing(tabValue, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }).start()
      } else if (secondTabAppeared && (y < boundary)) {
        Animated.timing(tabValue, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start(() => { setSecondTabAppeared(false) })
      }
    }
  }

  const afterCoronaClose = () => {
    checkIfNotice()
    checkDeepLink()
  }

  const onPressChat = useCallback(() => {
    ChannelModule.open()
  }, [])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        <FlatList
          onScroll={onScroll(0)}
          style={{ display: selectedTab === 0 ? 'flex' : 'none' }}
          ListHeaderComponent={renderHeader}
          data={selectedTab === 0 ? applications : []}
          keyExtractor={applicationKeyExtractor}
          renderItem={renderItem}
          ListEmptyComponent={renderEmptyView}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.1}
          bounces={false}
        />
        <FlatList
          onScroll={onScroll(1)}
          style={{ display: selectedTab === 1 ? 'flex' : 'none' }}
          ListHeaderComponent={renderHeader}
          data={selectedTab === 1 ? appliedList : []}
          keyExtractor={appliedKeyExtractor}
          renderItem={renderAppliedItem}
          ListEmptyComponent={renderEmptyView}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.1}
          bounces={false}
        />
        {/* 같은 탭이지만 랜더링 오류 때문에 서로 다른 state를 사용 */}
        {tabAppeared && (
          <Animated.View style={[styles.animatedTab, { opacity: tabValue }]}>
            {renderTab()}
          </Animated.View>
        )}
        {secondTabAppeared && (
          <Animated.View style={[styles.animatedTab, { opacity: tabValue }]}>
            {renderTab()}
          </Animated.View>
        )}
        <TouchableOpacity
          style={styles.chatbot}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.8}
          onPress={onPressChat}
        >
          <Image source={require('../../images/imgChat.png')} />
        </TouchableOpacity>
      </View>
      {slideVisible && renderSlideModal()}
      <Modal
        visible={coronaCheck}
        animationType='slide'
        onRequestClose={() => {}}
      >
        <CoronaCheckScreen
          afterClose={afterCoronaClose}
          removeCoronaList={ScheduleActions.removeCoronaList}
        />
      </Modal>
      <Toast ref={toastRef} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  topView: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 25,
    marginBottom: 10,
    marginHorizontal: 25,
  },
  settingVillage: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  villageView: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    marginRight: 20,
  },
  village: {
    ...customStyle.center,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: colors.black01,
    borderRadius: 10,
  },
  tab: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 25,
  },
  banner: {
    ...customStyle.center,
    flex: 1,
    borderRadius: 5,
    overflow: 'hidden',
  },
  bannerPage: {
    ...customStyle.center,
    width: 22 * screenRatio,
    height: 11 * screenRatio,
    position: 'absolute',
    right: 32 * screenRatio,
    bottom: 12 * screenRatio,
    backgroundColor: colors.black05,
    borderRadius: 10,
  },
  interviewButton: {
    ...customStyle.center,
    marginTop: 15,
    width: '100%',
    height: 47,
    backgroundColor: colors.main,
    borderRadius: 8,
  },
  playTodayImg: {
    width: '100%',
    height: 55,
  },
  scheduleButton: {
    ...customStyle.center,
    height: 50,
    backgroundColor: colors.main,
    borderRadius: 8,
  },
  scheduleView: {
    flex: 1,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  slideInnerView: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.white,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
  },
  emptyView: {
    ...customStyle.center,
    height: screenHeight / 2,
  },
  animatedTab: {
    width: '100%',
    position: 'absolute',
    backgroundColor: colors.white,
  },
  chatbot: {
    position: 'absolute',
    bottom: 25,
    right: 24,
  },
})

export default connect(
  state => ({
    notices: state.service.get('notices').toJS(),
    profile: state.profile.get('profile').toJS(),
    coronaCheck: state.schedule.get('coronaCheck'),
    villagesData: state.request.get('villages').toJS(),
    scheduleToday: state.schedule.get('scheduleToday').toJS(),
  }),
  dispatch => ({
    ServiceActions: bindActionCreators(serviceActions, dispatch),
    ScheduleActions: bindActionCreators(scheduleActions, dispatch),
    RequestActions: bindActionCreators(requestActions, dispatch),
  })
)(FindPlayScreen)