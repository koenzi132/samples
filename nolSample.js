import React, { useState, useCallback, useEffect } from 'react'
import {
  StyleSheet,
  View,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  Image,
  Linking,
} from 'react-native'
import _ from 'underscore'
import { Calendar } from 'react-native-calendars'
import moment from 'moment'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import { fromToTime } from 'noldam-utils/time'

import { RatioText, CustomSlide } from '../../components/Base'
import { colors, screenRatio, fonts, customStyle } from '../../lib/styleUtils'
import { useCustomSlide } from '../../hooks'
import { logEvent } from '../../lib/analyticsEventsMethod'
import events from '../../lib/events'

import * as matchingActions from '../../redux/modules/matching'
import * as requestActions from '../../redux/modules/request'

const MatchingScreen = ({
  MatchingActions,
  RequestActions,
  navigation,
  playAdresList,
  token,
}) => {
  const [startDate, setStartDate] = useState(moment().subtract(1, 'months').format('YYYY-MM-DD'))
  const [endDate, setEndDate] = useState(moment().format('YYYY-MM-DD'))

  const [tempStart, setTempStart] = useState('')
  const [tempEnd, setTempEnd] = useState('')

  const [goingData, setGoingData] = useState([])
  const [goingPage, setGoingPage] = useState(1)
  const [goingLastPage, setGoingLastPage] = useState(1)
  const [goingRefresh, setGoingRefresh] = useState(false)

  const [doneData, setDoneData] = useState([])
  const [donePage, setDonePage] = useState(1)
  const [doneLastPage, setDoneLastPage] = useState(1)
  const [doneRefresh, setDoneRefresh] = useState(false)

  const {
    visible,
    slideY,
    slideHeight,
    onChangeSlide,
  } = useCustomSlide({ height: 600 * screenRatio })

  const [tab, setTab] = useState(0)
  const isFirstTab = tab === 0

  useEffect(() => {
    fetchPlayData('going', 1)
    fetchPlayData('done', 1, startDate, endDate)
  }, [])

  const fetchPlayData = async (
    status,
    page,
    start,
    end,
  ) => {
    const params = {
      status,
      page,
    }
    const isGoing = status === 'going'

    if (start && end) {
      params.start_date = start
      params.end_date = end
    }

    MatchingActions.fetchPlays(params).then(response => {
      const { list, lastPage } = response.data

      if (page === 1) {
        if (isGoing) {
          setGoingData(list)
          setGoingLastPage(lastPage)
        } else {
          setDoneData(list)
          setDoneLastPage(lastPage)
        }
        return
      }

      if (isGoing) {
        setGoingData(goingData.concat(list))
      } else {
        setDoneData(doneData.concat(list))
      }
    }).catch(error => { console.log(error) })
  }

  const onPressTab = useCallback(index => () => {
    if (tab !== index) {
      setTab(index)
    }
  }, [tab])

  const renderTab = () => (
    <View style={{ flexDirection: 'row', paddingHorizontal: 24 }}>
      <TouchableOpacity
        style={[styles.tab, isFirstTab && { borderBottomColor: colors.main }]}
        onPress={onPressTab(0)}
        activeOpacity={0.8}
      >
        <RatioText bold={isFirstTab} color={isFirstTab ? 'black09' : 'black06'}>
          놀이 진행
        </RatioText>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, !isFirstTab && { borderBottomColor: colors.main }]}
        onPress={onPressTab(1)}
        activeOpacity={0.8}
      >
        <RatioText bold={!isFirstTab} color={!isFirstTab ? 'black09' : 'black06'}>
          놀이 완료
        </RatioText>
      </TouchableOpacity>
    </View>
  )

  const onPressMatchingDetail = useCallback(play => () => {
    navigation.navigate('MatchingDetail', { play })
  }, [])

  const onPressReapply = item => async () => {
    const { sitter_id: sitterId, id } = item
console.log(item,'item')
    if (sitterId && id) {
      const details = await MatchingActions.fetchMatchingDetail({ play_id: id })
      const { data } = details

      // 프로그램일 경우 웹으로 이동
      if (data.isProgram) {
        const uri = `https://noldam.co.kr/program?token=${token}`
        Linking.canOpenURL(uri).then(() => {
          Linking.openURL(uri)
        })
        return
      }

      const hasAdres = playAdresList.some(tempItem => tempItem.adres_id === data.adres.adres_id)

      const requestData = {
        adres: hasAdres ? data.adres: {},
        children: [],
        schedules: [],
        homeInfo: data.homeInfo,
        sitter: data.sitter,
      }

      await RequestActions.setRequest(requestData)

      navigation.navigate('SelectPlayType', { screenType: 'reapply' })
    }
  }

  const renderGoingItem = ({ item, index }) => {
    if (!item) return null

    const { start, hour, date, name, remainingCount } = item
    const playtime = `${fromToTime(start, hour)} (${hour}시간)`

    return (
      <View style={[styles.itemContainer, index === 0 && { marginTop: 20 }]}>
        <TouchableOpacity
          style={styles.itemTop}
          activeOpacity={0.8}
          onPress={onPressMatchingDetail(item)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={require('../../images/imgIngCopy.png')} style={{ marginRight: 3 }} />
              <RatioText size={16} font={fonts.black} lineHeight={26}>
                {`${moment(date).format('M월 DD일 ddd요일')}`}
              </RatioText>
            </View>
            <Image source={require('../../images/icnRightArrow.png')} style={styles.rightArrow} resizeMode='contain' />
          </View>
          <RatioText font={fonts.black} size={16} lineHeight={26} style={{ marginLeft: 20 }}>
            {`${name} 시터`}
            <RatioText size={16}>
              와 돌봄 진행 중
            </RatioText>
          </RatioText>
          {((remainingCount > 0) && (remainingCount < 4)) && (
            <RatioText size={14} color='main' style={{ marginTop: 10, marginLeft: 20 }} bold>
              {`남은 놀이 ${remainingCount}회`}
            </RatioText>
          )}
        </TouchableOpacity>
        <View style={styles.itemBottom}>
          <View style={{ flexDirection: 'row' }}>
            <RatioText bold style={{ marginRight: 7 }}>
              시간
            </RatioText>
            <RatioText>
              {playtime}
            </RatioText>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.reapplyButton}
            onPress={onPressReapply(item)}
          >
            <RatioText bold>
              시터에게 재방문 신청
            </RatioText>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const onPressDiary = useCallback(item => () => {
    if (item) {
      const { id, date, name, isBefore } = item
      logEvent(events.diaryClick)
      navigation.navigate('Diary', {
        id,
        date,
        name,
        isBefore,
      })
    }
  }, [])

  const renderDoneItem = ({ item }) => {
    if (!item) return null

    const { start, hour, date, name, isDone } = item
    const playtime = `${fromToTime(start, hour)} (${hour}시간)`
    const statusText = isDone ? '아이의 놀이일기를 확인해주세요' : '놀이일기가 작성 중이에요'

    return (
      <View style={styles.itemContainer}>
        <TouchableOpacity
          style={styles.itemTop}
          activeOpacity={0.8}
          onPress={onPressMatchingDetail(item)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={require('../../images/imgRoundCheck.png')} style={{ marginRight: 3 }} />
              <RatioText size={16} font={fonts.black} lineHeight={26}>
                {`${moment(date).format('M월 DD일 ddd요일')}`}
              </RatioText>
            </View>
            <Image source={require('../../images/icnRightArrow.png')} style={styles.rightArrow} resizeMode='contain' />
          </View>
          <RatioText font={fonts.black} size={16} lineHeight={26} style={{ marginLeft: 20 }}>
            {`${name} 시터 `}
            <RatioText size={16}>
              돌봄 완료
            </RatioText>
          </RatioText>
        </TouchableOpacity>
        <View style={styles.itemBottom}>
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            <RatioText bold style={{ marginRight: 7 }}>
              상태
            </RatioText>
            <RatioText>
              {statusText}
            </RatioText>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <RatioText bold style={{ marginRight: 7 }}>
              시간
            </RatioText>
            <RatioText>
              {playtime}
            </RatioText>
          </View>
          {isDone ? (
            <View style={{ flexDirection: 'row', marginTop: 18 }}>
              <TouchableOpacity
                style={styles.halfButton}
                activeOpacity={0.8}
                onPress={onPressReapply(item)}
              >
                <RatioText bold>
                  재방문 신청
                </RatioText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.halfButton, { marginLeft: 8, backgroundColor: colors.veryLightPinkFive }]}
                activeOpacity={0.8}
                onPress={onPressDiary(item)}
              >
                <RatioText bold>
                  놀이 일기
                </RatioText>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.reapplyButton}
              onPress={onPressReapply(item)}
            >
              <RatioText bold>
                시터에게 재방문 신청
              </RatioText>
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  const onPressDateBox = () => {
    onChangeSlide()

    setTempStart('')
    setTempEnd('')
  }

  const renderDateBox = () => {
    const startText = startDate || moment().format('YYYY-MM-DD')
    const endText = endDate || moment().format('YYYY-MM-DD')
    return (
      <View style={{ marginTop: 21, marginHorizontal: 24 }}>
        <RatioText size={16} bold>
          돌봄 기간을 선택해보세요
        </RatioText>
        <TouchableOpacity
          style={[styles.dateBox, startDate && endDate && { backgroundColor: colors.white, borderColor: colors.black05 }]}
          activeOpacity={0.8}
          onPress={onPressDateBox}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image
              source={require('../../images/icnCalendar.png')}
              style={[{ marginRight: 5 }, !startDate && { tintColor: colors.black05 }]}
            />
            <RatioText color={startDate ? 'black09' : 'black05'}>
              {startText}
            </RatioText>
          </View>
          <View style={styles.dateBar} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image
              source={require('../../images/icnCalendar.png')}
              style={[{ marginRight: 5 }, !endDate && { tintColor: colors.black05 }]}
            />
            <RatioText color={endDate ? 'black09' : 'black05'}>
              {endText}
            </RatioText>
          </View>
        </TouchableOpacity>
      </View>
    )
  }

  const emptyContent = () => {
    const emptyText = isFirstTab ? '진행 중인 놀이가 없어요' : '완료된 놀이가 없어요'
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Image
          source={require('../../images/imgCancel.png')}
          style={{ width: 60 * screenRatio, height: 60 * screenRatio }}
        />
        <RatioText size={16} bold style={{ marginTop: 5 }}>
          {emptyText}
        </RatioText>
      </View>
    )
  }

  const onPressDate = date => () => {
    const startEmpty = _.isEmpty(tempStart)
    const endEmpty = _.isEmpty(tempEnd)

    if (startEmpty && endEmpty) {
      setTempStart(date)
    } else if (!startEmpty && endEmpty) {
      const dayGap = moment(date).diff(moment(tempStart), 'days')

      if (dayGap <= 0) {
        setTempStart(date)
      } else {
        setTempEnd(date)
      }
    } else if (!startEmpty && !endEmpty) {
      setTempStart(date)
      setTempEnd('')
    }
  }

  const renderDay = ({ date, state, marking }) => {
    const isToday = state === 'today'
    const selected = marking.isSelected
    const between = marking.isBetween

    let textColor = isToday ? 'main' : 'black09'

    if (selected) {
      textColor = 'white'
    }

    return (
      <TouchableOpacity
        style={[
          styles.day,
          selected && { backgroundColor: colors.main, borderColor: colors.main },
          between && { backgroundColor: colors.veryLightPinkFive, borderColor: colors.veryLightPinkFive }
        ]}
        activeOpacity={0.8}
        onPress={onPressDate(date.dateString)}
      >
        <View>
          <RatioText size={13} color={textColor} bold={selected}>
            {date.day}
          </RatioText>
        </View>
      </TouchableOpacity>
    )
  }

  const onSelectDate = () => {
    setDoneData([])
    setDonePage(1)
    setStartDate(tempStart)
    setEndDate(tempEnd)
    fetchPlayData('done', 1, tempStart, tempEnd)
    onChangeSlide()
  }

  const slideContent = () => {    
    const startEmpty = _.isEmpty(tempStart)
    const endEmpty = _.isEmpty(tempEnd)
    
    const markedDates = {}

    if (!startEmpty) {
      markedDates[tempStart] = { isSelected: true }
    }
    if (!endEmpty) {
      markedDates[tempEnd] = { isSelected: true }
    }
    if (!startEmpty && !endEmpty) {
      const count = moment(tempEnd).diff(tempStart, 'days') - 1

      if (count > 0) {
        for (let i = 1; i <= count; i += 1) {
          const newDate = moment(tempStart).add(i, 'day').format('YYYY-MM-DD')
          markedDates[newDate] = { isBetween: true }
        }
      }
    }

    const buttonDisabled = startEmpty || endEmpty

    return (
      <View style={{ flex: 1, paddingTop: 30 }}>
        <Calendar
          markedDates={markedDates}
          style={{ marginHorizontal: 15 }}
          hideExtraDays
          theme={{
            arrowColor: colors.black09,
            textMonthFontFamily: fonts.bold,
            textSectionTitleColor: colors.black09,
            textDayHeaderFontSize: 17,
            textMonthFontWeight: 'bold',
          }}
          monthFormat='yyyy년 MM월'
          dayComponent={renderDay}
        />
        <TouchableOpacity
          style={[styles.dateSelect, !buttonDisabled && { backgroundColor: colors.main }]}
          activeOpacity={0.8}
          disabled={buttonDisabled}
          onPress={onSelectDate}
        >
          <RatioText bold color='white'>
            기간 등록
          </RatioText>
        </TouchableOpacity>
      </View>
    )
  }

  const onGoingKeyExtractor = (item, index) => String(index)

  const completedkeyExtractor = (item, index) => String(index)

  const onEndReached = () => {
    if (isFirstTab) {
      if (goingPage < goingLastPage) {
        const newPage = goingPage + 1

        setGoingPage(newPage)
        fetchPlayData('going', newPage)
      }
    } else if (donePage < doneLastPage) {
      const newPage = donePage + 1

      setDonePage(newPage)
      fetchPlayData('done', newPage, startDate, endDate)
    }
  }

  const onRefresh = async () => {
    if (isFirstTab) {
      setGoingRefresh(true)
      setGoingPage(1)
      await fetchPlayData('going', 1)

      setTimeout(() => {
        setGoingRefresh(false)
      }, 500)
    } else {
      setDoneRefresh(true)
      const initStart = moment().subtract(1, 'months').format('YYYY-MM-DD')
      const initEnd = moment().format('YYYY-MM-DD')

      setDonePage(1)
      setStartDate(initStart)
      setEndDate(initEnd)
      await fetchPlayData('done', 1, initStart, initEnd)
      setTimeout(() => {
        setDoneRefresh(false)
      }, 500)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView />
      {renderTab()}
      <FlatList
        contentContainerStyle={_.isEmpty(goingData) && { flex: 1 }}
        showsVerticalScrollIndicator={false}
        style={{ display: isFirstTab ? 'flex' : 'none', flex: 1 }}
        data={goingData}
        renderItem={renderGoingItem}
        ListEmptyComponent={emptyContent}
        keyExtractor={onGoingKeyExtractor}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.1}
        onRefresh={onRefresh}
        refreshing={goingRefresh}
      />
      <FlatList
        contentContainerStyle={_.isEmpty(doneData) && { flex: 1 }}
        showsVerticalScrollIndicator={false}
        style={{ display: isFirstTab ? 'none' : 'flex' }}
        data={doneData}
        renderItem={renderDoneItem}
        ListEmptyComponent={emptyContent}
        keyExtractor={completedkeyExtractor}
        ListHeaderComponent={renderDateBox}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.1}
        onRefresh={onRefresh}
        refreshing={doneRefresh}
      />
      <CustomSlide
        slideY={slideY}
        slideVisible={visible}
        onChangeSlide={onChangeSlide}
        slideHeight={slideHeight}
        content={slideContent()}
        backgroundCallback={onPressDateBox}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  tab: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: colors.black03,
  },
  itemContainer: {
    marginBottom: 16,
    marginHorizontal: 24,
    borderWidth: 1,
    borderColor: colors.black03,
    borderRadius: 5,
  },
  itemTop: {
    paddingVertical: 15,
    paddingHorizontal: 12,
    backgroundColor: colors.black01,
    borderRadius: 5,
  },
  rightArrow: {
    width: 12,
    height: 12,
    tintColor: colors.black08,
  },
  itemBottom: {
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  reapplyButton: {
    ...customStyle.center,
    marginTop: 18,
    height: 44 * screenRatio,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.veryLightPinkFour,
    backgroundColor: colors.lightPink,
  },
  dateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
    marginBottom: 25,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.black02,
    backgroundColor: colors.black01,
    borderRadius: 5,
  },
  dateBar: {
    width: 22,
    borderTopWidth: 1,
    borderTopColor: colors.black05,
    marginHorizontal: 24,
  },
  day: {
    ...customStyle.center,
    width: 42 * screenRatio,
    height: 42 * screenRatio,
    borderWidth: 1,
    borderColor: colors.black02,
    borderRadius: 2,
  },
  dateSelect: {
    alignItems: 'center',
    marginTop: 25,
    marginHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.black03,
    borderRadius: 5,
  },
  halfButton: {
    ...customStyle.center,
    flex: 1,
    height: 44 * screenRatio,
    borderWidth: 1,
    borderColor: colors.veryLightPinkFour,
    borderRadius: 5,
  },
})

export default connect(
  state => ({
    playAdresList: state.request.get('playAdresList').toJS(),
    token: state.auth.getIn(['login', 'token']),
  }),
  dispatch => ({
    MatchingActions: bindActionCreators(matchingActions, dispatch),
    RequestActions: bindActionCreators(requestActions, dispatch),
  })
)(MatchingScreen)
